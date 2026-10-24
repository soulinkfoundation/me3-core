<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { MARKETING_PERMISSION_ATTESTATION_STATEMENT } from "@me3-core/plugin-email-campaigns";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import ConfirmationDialog from "../ConfirmationDialog.vue";
import { useAppToast } from "../../composables/useAppToast";
import { useSitesStore, type Subscriber } from "../../stores/sites";
import { formatCount } from "../../utils/campaigns";

const props = defineProps<{ initialSite?: string }>();

const PAGE_SIZE = 50;
const sites = useSitesStore();
const { toastError, toastSuccess } = useAppToast();
const username = ref("");
const subscribers = ref<Subscriber[]>([]);
const total = ref(0);
const page = ref(1);
const pages = ref(1);
const loading = ref(false);
const exporting = ref(false);
const removing = ref<Subscriber | null>(null);
const removeBusy = ref(false);
const sheet = ref<"add" | "import" | null>(null);
const addEmail = ref("");
const addFirstName = ref("");
const addLastName = ref("");
const permissionConfirmed = ref(false);
const importFile = ref<File | null>(null);
const working = ref(false);
const sheetTitleId = `campaign-subscribers-sheet-${useId()}`;

const siteOptions = computed(() => sites.sites.filter((site) => site.published_at || site.site_role === "profile"));

function statusOf(subscriber: Subscriber) {
  if (subscriber.delivery_status === "bounced") return { label: "Bounced", tone: "bad" };
  if (subscriber.delivery_status === "complained") return { label: "Marked as spam", tone: "bad" };
  if (subscriber.delivery_status === "suppressed") return { label: "Blocked", tone: "bad" };
  if (subscriber.marketing_status === "pending") return { label: "Can't email yet", tone: "warn" };
  return { label: "Subscribed", tone: "ok" };
}

function displayName(subscriber: Subscriber) {
  return [subscriber.first_name, subscriber.last_name].filter(Boolean).join(" ");
}

function joined(subscriber: Subscriber) {
  const date = new Date(subscriber.subscribed_at.replace(" ", "T") + (subscriber.subscribed_at.includes("Z") ? "" : "Z"));
  if (Number.isNaN(date.getTime())) return "";
  return `Joined ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date)}`;
}

async function load(nextPage = 1) {
  if (!username.value) return;
  loading.value = true;
  const result = await sites.getSubscribers(username.value, nextPage, PAGE_SIZE);
  loading.value = false;
  if (!result) {
    toastError("Couldn't load subscribers.");
    return;
  }
  subscribers.value = nextPage === 1 ? result.subscribers : [...subscribers.value, ...result.subscribers];
  total.value = result.pagination.total;
  page.value = result.pagination.page;
  pages.value = result.pagination.pages;
}

async function exportList() {
  if (exporting.value) return;
  exporting.value = true;
  await sites.exportSubscribers(username.value);
  exporting.value = false;
}

function openSheet(kind: "add" | "import") {
  addEmail.value = "";
  addFirstName.value = "";
  addLastName.value = "";
  importFile.value = null;
  permissionConfirmed.value = false;
  sheet.value = kind;
}

function closeSheet() {
  if (!working.value) sheet.value = null;
}

function pickFile(event: Event) {
  importFile.value = (event.target as HTMLInputElement).files?.[0] || null;
}

async function submitSheet() {
  if (working.value) return;
  working.value = true;
  try {
    if (sheet.value === "add") {
      const email = addEmail.value.trim();
      if (!email) {
        toastError("Add an email address.");
        return;
      }
      const result = await sites.addSubscriber(
        username.value,
        email,
        addFirstName.value.trim() || undefined,
        addLastName.value.trim() || undefined,
        permissionConfirmed.value,
      );
      if (!result) {
        toastError(sites.error || "Couldn't add them.");
        return;
      }
      toastSuccess(result.resubscribed ? `${email} is back on the list.` : `${email} added.`);
    } else if (sheet.value === "import") {
      if (!importFile.value) {
        toastError("Choose a CSV file.");
        return;
      }
      const result = await sites.importSubscribers(username.value, importFile.value, permissionConfirmed.value);
      if (!result) {
        toastError(sites.error || "Couldn't import that file.");
        return;
      }
      toastSuccess(
        `Added ${formatCount(result.imported)}${result.skipped ? ` · ${formatCount(result.skipped)} skipped (already on the list or no valid email)` : ""}.`,
      );
    }
    sheet.value = null;
    await load(1);
  } finally {
    working.value = false;
  }
}

async function confirmRemove() {
  const subscriber = removing.value;
  if (!subscriber || removeBusy.value) return;
  removeBusy.value = true;
  const ok = await sites.deleteSubscriber(username.value, subscriber.id);
  removeBusy.value = false;
  if (!ok) {
    toastError("Couldn't remove them.");
    return;
  }
  subscribers.value = subscribers.value.filter((item) => item.id !== subscriber.id);
  total.value = Math.max(0, total.value - 1);
  removing.value = null;
}

watch(
  siteOptions,
  (options) => {
    if (username.value || !options.length) return;
    const wanted = options.find((site) => site.username === props.initialSite);
    username.value = (wanted || options.find((site) => site.site_role === "profile") || options[0])!.username;
  },
  { immediate: true },
);
watch(username, () => void load(1), { immediate: true });
void sites.ensureSites();
</script>

<template>
  <section class="campaign-subscribers" aria-label="Subscribers">
    <div class="campaign-subscribers__bar">
      <p class="campaign-subscribers__count">
        <b>{{ formatCount(total) }}</b> {{ total === 1 ? "subscriber" : "subscribers" }}
        <template v-if="siteOptions.length <= 1 && username"> on @{{ username }}</template>
      </p>
      <label v-if="siteOptions.length > 1" class="campaign-subscribers__site">
        <span class="sr-only">Site</span>
        <select v-model="username">
          <option v-for="site in siteOptions" :key="site.id" :value="site.username">@{{ site.username }}</option>
        </select>
      </label>
    </div>
    <div class="campaign-subscribers__actions">
      <Button color="secondary" shape="pill" size="compact" :disabled="!username" @click="openSheet('add')">Add</Button>
      <Button color="secondary" shape="pill" size="compact" :disabled="!username" @click="openSheet('import')">Import CSV</Button>
      <Button color="ghost" shape="soft" size="compact" :disabled="!total || exporting" @click="exportList">
        {{ exporting ? "Exporting…" : "Export" }}
      </Button>
    </div>

    <ul v-if="subscribers.length" class="campaign-subscribers__list">
      <li v-for="subscriber in subscribers" :key="subscriber.id" class="campaign-subscriber">
        <div class="campaign-subscriber__main">
          <span class="campaign-subscriber__email">{{ subscriber.email }}</span>
          <span class="campaign-subscriber__detail">{{ [displayName(subscriber), joined(subscriber)].filter(Boolean).join(" · ") }}</span>
        </div>
        <span class="campaign-pill" :class="`campaign-pill--${statusOf(subscriber).tone}`">{{ statusOf(subscriber).label }}</span>
        <Button
          class="campaign-subscriber__remove"
          color="ghost"
          shape="soft"
          size="small"
          :aria-label="`Remove ${subscriber.email}`"
          @click="removing = subscriber"
        >Remove</Button>
      </li>
    </ul>
    <p v-else-if="!loading" class="campaign-subscribers__empty">
      No subscribers yet. People who sign up on your site show up here.
    </p>
    <Button
      v-if="page < pages"
      class="campaign-subscribers__more"
      color="ghost"
      shape="soft"
      size="compact"
      :disabled="loading"
      @click="load(page + 1)"
    >{{ loading ? "Loading…" : "Show more" }}</Button>

    <AppDialog :open="Boolean(sheet)" :labelled-by="sheetTitleId" close-on-backdrop @close="closeSheet">
      <form class="campaign-subscribers-sheet" @submit.prevent="submitSheet">
        <h2 :id="sheetTitleId">{{ sheet === "add" ? "Add a subscriber" : "Import subscribers" }}</h2>
        <template v-if="sheet === 'add'">
          <label class="campaign-subscribers-sheet__field">
            <span>Email</span>
            <input v-model="addEmail" type="email" autocomplete="off" required />
          </label>
          <div class="campaign-subscribers-sheet__row">
            <label class="campaign-subscribers-sheet__field">
              <span>First name</span>
              <input v-model="addFirstName" autocomplete="off" />
            </label>
            <label class="campaign-subscribers-sheet__field">
              <span>Last name</span>
              <input v-model="addLastName" autocomplete="off" />
            </label>
          </div>
        </template>
        <template v-else>
          <label class="campaign-subscribers-sheet__field">
            <span>CSV file with an email column</span>
            <input type="file" accept=".csv,text/csv" @change="pickFile" />
          </label>
          <p class="campaign-subscribers-sheet__hint">Names and sign-up dates are picked up if the file has them. People already on the list are skipped.</p>
        </template>
        <label class="campaign-subscribers-sheet__consent">
          <input v-model="permissionConfirmed" type="checkbox" />
          <span>{{ MARKETING_PERMISSION_ATTESTATION_STATEMENT }}</span>
        </label>
        <p v-if="!permissionConfirmed" class="campaign-subscribers-sheet__hint">
          Without this they're saved but won't get campaigns.
        </p>
        <div class="campaign-subscribers-sheet__actions">
          <Button color="outline" shape="soft" size="compact" type="button" :disabled="working" @click="closeSheet">Cancel</Button>
          <Button color="primary" shape="soft" size="compact" type="submit" :disabled="working">
            {{ working ? "Saving…" : sheet === "add" ? "Add" : "Import" }}
          </Button>
        </div>
      </form>
    </AppDialog>

    <ConfirmationDialog
      :open="Boolean(removing)"
      title="Remove this subscriber?"
      :message="`${removing?.email || ''} will be taken off the list and won't get campaigns.`"
      confirm-label="Remove"
      cancel-label="Keep"
      :busy="removeBusy"
      danger
      @cancel="removing = null"
      @confirm="confirmRemove"
    />
  </section>
</template>

<style scoped>
.campaign-subscribers { margin-top: 14px; }
.campaign-subscribers__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.campaign-subscribers__count { margin: 0; color: var(--ui-text-muted); font-size: 14px; }
.campaign-subscribers__count b { color: var(--ui-text); font-weight: 650; font-variant-numeric: tabular-nums; }
.campaign-subscribers__site select { min-height: 32px; padding: 2px 8px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface); color: var(--ui-text); font: inherit; font-size: 13px; }
.campaign-subscribers__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.campaign-subscribers__list { margin: 16px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--ui-border); }
.campaign-subscriber { display: flex; align-items: center; gap: 8px; padding: 9px 2px; border-bottom: 1px solid var(--ui-border); }
.campaign-subscriber__main { display: grid; flex: 1 1 auto; min-width: 0; gap: 1px; }
.campaign-subscriber__email { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.campaign-subscriber__detail { overflow: hidden; color: var(--ui-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.campaign-subscriber :deep(.campaign-subscriber__remove) { min-height: 32px; padding-inline: 6px; color: var(--ui-text-muted); }
.campaign-pill { --tone: var(--ui-text-muted); flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--tone) 13%, transparent); color: var(--tone); font-size: 12px; font-weight: 600; white-space: nowrap; }
.campaign-pill--ok { --tone: var(--ui-success, color-mix(in oklab, #1f8a5b 70%, var(--ui-text))); }
.campaign-pill--warn { --tone: var(--ui-warning, color-mix(in oklab, #b26a00 70%, var(--ui-text))); }
.campaign-pill--bad { --tone: var(--ui-danger, color-mix(in oklab, #c62828 75%, var(--ui-text))); }
.campaign-subscribers__empty { margin: 20px 0 0; color: var(--ui-text-muted); font-size: 14px; }
.campaign-subscribers :deep(.campaign-subscribers__more) { margin-top: 10px; }
.campaign-subscribers-sheet { box-sizing: border-box; display: grid; gap: 14px; width: min(100%, 440px); padding: 20px; border-radius: var(--ui-radius-lg); background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-md); }
.campaign-subscribers-sheet h2 { margin: 0; font-size: 18px; }
.campaign-subscribers-sheet__row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.campaign-subscribers-sheet__field { display: grid; gap: 4px; min-width: 0; }
.campaign-subscribers-sheet__field > span { color: var(--ui-text-muted); font-size: 12px; font-weight: 600; }
.campaign-subscribers-sheet__field input:not([type="file"]) { box-sizing: border-box; width: 100%; min-height: 38px; padding: 6px 10px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-bg); color: var(--ui-text); font: inherit; }
.campaign-subscribers-sheet__field input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.campaign-subscribers-sheet__consent { display: flex; align-items: flex-start; gap: 8px; font-size: 14px; line-height: 1.4; }
.campaign-subscribers-sheet__consent input { margin-top: 3px; }
.campaign-subscribers-sheet__hint { margin: -6px 0 0; color: var(--ui-text-muted); font-size: 12px; }
.campaign-subscribers-sheet__actions { display: flex; justify-content: flex-end; gap: 8px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 480px) {
  .campaign-subscriber { flex-wrap: wrap; }
  .campaign-subscriber__main { flex-basis: 100%; }
  .campaign-subscribers-sheet__row { grid-template-columns: 1fr; }
}
</style>
