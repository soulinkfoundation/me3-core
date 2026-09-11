<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { useRoute, useRouter } from "vue-router";
import { API_BASE, api } from "../api";
import AppDialog from "../components/AppDialog.vue";
import Button from "../components/Button.vue";
import PageLoading from "../components/PageLoading.vue";
import UiIcon from "../components/UiIcon.vue";
import { useAppToast } from "../composables/useAppToast";
import { COMMERCE_CURRENCY_OPTIONS } from "../utils/commerce";

definePage({
  path: "/accounts",
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    requiresPlugin: "me3.accounts",
    title: "Accounts | ME3",
    description: "Manage income, expenses, and customers in one place.",
    robots: "noindex,follow",
  },
});

type EntryType = "income" | "expense";
type AccountsView = EntryType | "customers";
type EntryStatus = "pending" | "paid" | "overdue" | "cancelled" | "needs_review";
type EntrySource = "manual" | "email_triage" | "stripe" | "csv_import";
type Category = { id: string; name: string; entryType: EntryType };
type Entry = {
  id: string;
  date: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  projectId: string | null;
  projectName: string | null;
  amountCents: number;
  currency: string;
  status: EntryStatus;
  source: EntrySource;
  sourceEmailId: string | null;
  notes: string | null;
};
type MoneyTotal = { currency: string; amountCents: number };
type Stats = {
  thisMonthCents: number;
  lastMonthCents: number;
  thisMonthTotals?: MoneyTotal[];
  lastMonthTotals?: MoneyTotal[];
  defaultCurrency?: string;
};
type EntryForm = {
  date: string;
  description: string;
  categoryId: string;
  projectId: string;
  amount: string;
  currency: string;
  status: EntryStatus;
  notes: string;
};
type ProjectOption = { id: string; name: string };
type CustomerActivity = {
  id: string;
  kind: "purchase" | "booking";
  item: string;
  activityAt: string;
  amountCents: number | null;
  currency: string | null;
  status: string;
  siteName: string;
};
type Customer = {
  id: string;
  name: string;
  email: string;
  contactId: string | null;
  boughtOrBooked: string;
  latestActivity: string;
  siteNames: string[];
  activities: CustomerActivity[];
};
type CustomerItem = { value: string; label: string };

const PAGE_SIZE = 50;
const { toastFromUnknown, toastSuccess } = useAppToast();
const route = useRoute();
const router = useRouter();
const currentView = ref<AccountsView>(accountView(route.query.view));
const entryType = computed<EntryType>(() => currentView.value === "expense" ? "expense" : "income");
const entries = ref<Entry[]>([]);
const customers = ref<Customer[]>([]);
const customerItems = ref<CustomerItem[]>([]);
const expandedCustomerIds = ref(new Set<string>());
const categories = ref<Category[]>([]);
const projects = ref<ProjectOption[]>([]);
const stats = ref<Stats | null>(null);
const loading = ref(true);
const saving = ref(false);
const importing = ref(false);
const syncing = ref(false);
const entryDialogOpen = ref(false);
const filtersOpen = ref(false);
const editingEntryId = ref<string | null>(null);
const formError = ref("");
const total = ref(0);
const offset = ref(0);
const search = ref("");
const statusFilter = ref("");
const sourceFilter = ref("");
const itemFilter = ref("");
const stripeConfigured = ref(false);
const defaultCurrency = ref("USD");
const importInput = ref<HTMLInputElement | null>(null);
const actionsMenu = ref<HTMLDetailsElement | null>(null);
const form = ref<EntryForm>(emptyForm(entryType.value));
let accountsRequestId = 0;

const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1);
const hasPrevious = computed(() => offset.value > 0);
const hasNext = computed(() => offset.value + PAGE_SIZE < total.value);
const resultCountLabel = computed(() => {
  const label = currentView.value === "customers" ? "customer" : "entry";
  return total.value === 1 ? `1 ${label}` : `${total.value} ${label}s`;
});
const activeFilterCount = computed(() => currentView.value === "customers"
  ? [search.value.trim(), itemFilter.value].filter(Boolean).length
  : [search.value.trim(), statusFilter.value, sourceFilter.value].filter(Boolean).length,
);
const categoryOptions = computed(() =>
  categories.value.filter((category) => category.entryType === entryType.value),
);
const formDisabled = computed(
  () => saving.value || !form.value.date || !form.value.description.trim() || !text(form.value.amount),
);
const editingStripeEntry = computed(() =>
  Boolean(editingEntryId.value && entries.value.find((entry) => entry.id === editingEntryId.value)?.source === "stripe"),
);
const currencyOptions = computed(() => {
  const current = normalizeCurrency(form.value.currency);
  return current && !COMMERCE_CURRENCY_OPTIONS.some((option) => option.value === current)
    ? [{ value: current, label: current }, ...COMMERCE_CURRENCY_OPTIONS]
    : COMMERCE_CURRENCY_OPTIONS;
});

async function loadAccounts() {
  const requestId = ++accountsRequestId;
  const requestedView = currentView.value;
  loading.value = true;
  try {
    if (requestedView === "customers") {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset.value),
      });
      if (search.value.trim()) query.set("search", search.value.trim());
      if (itemFilter.value) query.set("item", itemFilter.value);
      const response = await api.get<{
        customers: Customer[];
        items: CustomerItem[];
        total: number;
      }>(`/accounts/customers?${query}`);
      if (requestId !== accountsRequestId || currentView.value !== requestedView) return;
      customers.value = response.customers || [];
      customerItems.value = response.items || [];
      total.value = response.total || 0;
      return;
    }

    const query = new URLSearchParams({
      entryType: entryType.value,
      limit: String(PAGE_SIZE),
      offset: String(offset.value),
    });
    if (search.value.trim()) query.set("search", search.value.trim());
    if (statusFilter.value) query.set("status", statusFilter.value);
    if (sourceFilter.value) query.set("source", sourceFilter.value);
    const [entryResponse, categoryResponse, statsResponse] = await Promise.all([
      api.get<{ entries: Entry[]; total: number }>(`/accounts/entries?${query}`),
      api.get<{ categories: Category[] }>(`/accounts/categories?entryType=${entryType.value}`),
      api.get<{ stats: Stats }>(`/accounts/stats?entryType=${entryType.value}`),
    ]);
    if (requestId !== accountsRequestId || currentView.value !== requestedView) return;
    entries.value = entryResponse.entries || [];
    total.value = entryResponse.total || 0;
    categories.value = categoryResponse.categories || [];
    stats.value = statsResponse.stats || null;
    defaultCurrency.value = normalizeCurrency(statsResponse.stats?.defaultCurrency) || "USD";
    if (!form.value.currency.trim()) form.value.currency = defaultCurrency.value;
  } catch (caught) {
    if (requestId === accountsRequestId) toastFromUnknown(caught, "Accounts could not load");
  } finally {
    if (requestId === accountsRequestId) loading.value = false;
  }
}

async function loadStripeStatus() {
  try {
    const response = await api.get<{ connected: boolean }>("/accounts/stripe/status");
    stripeConfigured.value = response.connected;
  } catch {
    stripeConfigured.value = false;
  }
}

async function loadProjects() {
  try {
    const response = await api.get<{ projects: ProjectOption[] }>("/mission-control/projects");
    projects.value = response.projects || [];
  } catch {
    projects.value = [];
  }
}

async function saveEntry() {
  if (formDisabled.value) return;
  const amount = Number(text(form.value.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    formError.value = "Amount must be greater than zero";
    return;
  }
  saving.value = true;
  formError.value = "";
  const id = editingEntryId.value;
  const payload = {
    entryType: entryType.value,
    date: form.value.date,
    description: form.value.description.trim(),
    categoryId: form.value.categoryId || null,
    projectId: form.value.projectId || null,
    amountCents: Math.round(amount * 100),
    currency: form.value.currency.trim().toUpperCase() || "USD",
    status: form.value.status,
    notes: form.value.notes.trim() || null,
  };
  try {
    if (id) await api.put(`/accounts/entries/${encodeURIComponent(id)}`, payload);
    else {
      await api.post("/accounts/entries", payload);
      offset.value = 0;
    }
    entryDialogOpen.value = false;
    editingEntryId.value = null;
    form.value = emptyForm(entryType.value);
    await loadAccounts();
    toastSuccess(id ? "Entry updated." : "Entry added.");
  } catch (caught) {
    toastFromUnknown(caught, id ? "Could not update account entry" : "Could not add account entry");
  } finally {
    saving.value = false;
  }
}

function openNewEntry() {
  editingEntryId.value = null;
  form.value = emptyForm(entryType.value);
  formError.value = "";
  entryDialogOpen.value = true;
}

function openEditEntry(entry: Entry) {
  editingEntryId.value = entry.id;
  form.value = {
    date: entry.date,
    description: entry.description,
    categoryId: entry.categoryId || "",
    projectId: entry.projectId || "",
    amount: (entry.amountCents / 100).toFixed(2),
    currency: entry.currency,
    status: entry.status,
    notes: entry.notes || "",
  };
  formError.value = "";
  entryDialogOpen.value = true;
}

function closeEntryDialog() {
  if (saving.value) return;
  entryDialogOpen.value = false;
  editingEntryId.value = null;
}

async function deleteEntry(entry: Entry) {
  if (!window.confirm(`Delete ${entry.description}?`)) return;
  try {
    await api.delete(`/accounts/entries/${encodeURIComponent(entry.id)}`);
    await loadAccounts();
    toastSuccess("Entry deleted.");
  } catch (caught) {
    toastFromUnknown(caught, "Could not delete account entry");
  }
}

async function setView(view: AccountsView) {
  if (currentView.value === view) return;
  currentView.value = view;
  offset.value = 0;
  search.value = "";
  statusFilter.value = "";
  sourceFilter.value = "";
  itemFilter.value = "";
  expandedCustomerIds.value = new Set();
  form.value = emptyForm(entryType.value);
  const { view: _view, ...query } = route.query;
  await router.replace({ query: view === "income" ? query : { ...query, view } });
  void loadAccounts();
}

function applyFilters() {
  offset.value = 0;
  filtersOpen.value = false;
  void loadAccounts();
}

function clearFilters() {
  search.value = "";
  statusFilter.value = "";
  sourceFilter.value = "";
  itemFilter.value = "";
  applyFilters();
}

function changePage(delta: number) {
  offset.value = Math.max(0, offset.value + delta * PAGE_SIZE);
  void loadAccounts();
}

function chooseImportFile() {
  if (actionsMenu.value) actionsMenu.value.open = false;
  importInput.value?.click();
}

async function importCsv(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importing.value = true;
  try {
    const data = new FormData();
    data.append("entryType", entryType.value);
    data.append("file", file);
    const response = await api.upload<{ imported: number; skipped: number; total: number }>(
      "/accounts/import",
      data,
    );
    offset.value = 0;
    await loadAccounts();
    toastSuccess(`Imported ${response.imported} of ${response.total}; skipped ${response.skipped}.`);
  } catch (caught) {
    toastFromUnknown(caught, "Could not import CSV");
  } finally {
    importing.value = false;
    input.value = "";
  }
}

function exportCsv() {
  if (actionsMenu.value) actionsMenu.value.open = false;
  const query = new URLSearchParams({ entryType: entryType.value });
  if (search.value.trim()) query.set("search", search.value.trim());
  if (statusFilter.value) query.set("status", statusFilter.value);
  if (sourceFilter.value) query.set("source", sourceFilter.value);
  window.location.href = `${API_BASE}/accounts/export?${query}`;
}

async function syncStripe() {
  if (actionsMenu.value) actionsMenu.value.open = false;
  syncing.value = true;
  try {
    const response = await api.post<{
      chargesImported: number;
      chargesUpdated: number;
      chargesProcessed: number;
    }>("/accounts/stripe/sync", {});
    if (currentView.value === "income") await loadAccounts();
    else await setView("income");
    toastSuccess(
      `Stripe sync processed ${response.chargesProcessed}; added ${response.chargesImported}, updated ${response.chargesUpdated}.`,
    );
  } catch (caught) {
    toastFromUnknown(caught, "Could not sync Stripe charges");
  } finally {
    syncing.value = false;
  }
}

function emptyForm(type: EntryType): EntryForm {
  return {
    date: todayKey(),
    description: "",
    categoryId: "",
    projectId: "",
    amount: "",
    currency: defaultCurrency.value,
    status: type === "income" ? "paid" : "pending",
    notes: "",
  };
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeCurrency(value: unknown): string | null {
  const currency = text(value).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function statusLabel(status: EntryStatus): string {
  return status === "needs_review" ? "Needs review" : status[0].toUpperCase() + status.slice(1);
}

function sourceLabel(source: EntrySource): string {
  if (source === "email_triage") return "Email triage";
  if (source === "csv_import") return "CSV import";
  return source[0].toUpperCase() + source.slice(1);
}

function accountView(value: unknown): AccountsView {
  return value === "expenses" || value === "expense"
    ? "expense"
    : value === "customers"
      ? "customers"
      : "income";
}

function toggleCustomer(customerId: string) {
  const next = new Set(expandedCustomerIds.value);
  if (next.has(customerId)) next.delete(customerId);
  else next.add(customerId);
  expandedCustomerIds.value = next;
}

function customerHistoryId(customerId: string): string {
  return `accounts-customer-${customerId.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function activityStatusLabel(status: string): string {
  return status === "payment_due"
    ? "Payment due"
    : status[0]?.toUpperCase() + status.slice(1);
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

function formatTotals(totals: MoneyTotal[] | undefined, cents: number, currency: string): string {
  const visible = (totals || []).filter((item) => item.amountCents > 0);
  return visible.length
    ? visible.map((item) => formatMoney(item.amountCents, item.currency)).join(" + ")
    : formatMoney(cents, currency);
}

function formatDate(value: string): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function todayKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

watch(
  () => route.query.view,
  (value) => {
    const next = accountView(value);
    if (next === currentView.value) return;
    currentView.value = next;
    offset.value = 0;
    void loadAccounts();
  },
);

onMounted(() => void Promise.all([loadAccounts(), loadProjects(), loadStripeStatus()]));
</script>

<template>
  <main class="accounts-page">
    <div class="accounts-workspace">
      <header class="accounts-toolbar">
        <div class="accounts-tabs" role="tablist" aria-label="Accounts views">
          <button id="accounts-tab-income" type="button" :class="{ 'is-active': currentView === 'income' }" role="tab" :aria-selected="currentView === 'income'" aria-controls="accounts-panel" @click="setView('income')">
            Income
          </button>
          <button id="accounts-tab-expenses" type="button" :class="{ 'is-active': currentView === 'expense' }" role="tab" :aria-selected="currentView === 'expense'" aria-controls="accounts-panel" @click="setView('expense')">
            Expenses
          </button>
          <button id="accounts-tab-customers" type="button" :class="{ 'is-active': currentView === 'customers' }" role="tab" :aria-selected="currentView === 'customers'" aria-controls="accounts-panel" @click="setView('customers')">
            Customers
          </button>
        </div>
        <div class="accounts-toolbar__actions">
          <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Search and filter" :active="Boolean(activeFilterCount)" @click="filtersOpen = true">
            <UiIcon name="Search" :size="17" /><span v-if="activeFilterCount" class="accounts-filter-count">{{ activeFilterCount }}</span>
          </Button>
          <Button v-if="currentView !== 'customers'" color="ghost" shape="soft" size="compact" icon-only aria-label="Add entry" @click="openNewEntry"><UiIcon name="Plus" :size="18" /></Button>
          <details v-if="currentView !== 'customers'" ref="actionsMenu" class="accounts-actions-menu">
            <summary aria-label="Account actions"><UiIcon name="Ellipsis" :size="18" /></summary>
            <div class="accounts-actions-menu__popover">
              <button type="button" :disabled="syncing || !stripeConfigured" @click="syncStripe"><UiIcon name="RefreshCw" :size="15" />{{ syncing ? "Syncing Stripe" : "Sync Stripe" }}</button>
              <button type="button" :disabled="importing" @click="chooseImportFile"><UiIcon name="Upload" :size="15" />{{ importing ? "Importing CSV" : "Import CSV" }}</button>
              <button type="button" @click="exportCsv"><UiIcon name="Download" :size="15" />Export CSV</button>
            </div>
          </details>
          <input ref="importInput" type="file" accept=".csv,text/csv" class="visually-hidden" @change="importCsv" />
        </div>
      </header>

      <section id="accounts-panel" role="tabpanel" :aria-labelledby="`accounts-tab-${currentView === 'expense' ? 'expenses' : currentView}`">
        <PageLoading v-if="loading && currentView !== 'customers' && !stats" compact label="Loading accounts..." />
        <div v-else-if="currentView !== 'customers'" class="accounts-summary">
          <div><span>This month</span><strong>{{ formatTotals(stats?.thisMonthTotals, stats?.thisMonthCents || 0, form.currency) }}</strong></div>
          <div><span>Last month</span><strong>{{ formatTotals(stats?.lastMonthTotals, stats?.lastMonthCents || 0, form.currency) }}</strong></div>
        </div>

        <div class="accounts-table-wrap">
          <table v-if="currentView === 'customers'" class="accounts-table accounts-table--customers">
            <caption class="visually-hidden">Customers and their purchases or bookings</caption>
            <thead><tr><th scope="col">Customer</th><th scope="col">Email</th><th scope="col">Bought / booked</th><th scope="col">Latest activity</th></tr></thead>
            <tbody>
              <tr v-if="loading"><td colspan="4"><PageLoading compact label="Loading customers..." /></td></tr>
              <tr v-else-if="customers.length === 0"><td colspan="4">No customers yet.</td></tr>
              <template v-for="customer in customers" v-else :key="customer.id">
                <tr>
                  <th scope="row">
                    <button type="button" class="customer-disclosure" :aria-expanded="expandedCustomerIds.has(customer.id)" :aria-controls="customerHistoryId(customer.id)" @click="toggleCustomer(customer.id)">
                      <UiIcon :name="expandedCustomerIds.has(customer.id) ? 'ChevronDown' : 'ChevronRight'" :size="16" aria-hidden="true" />
                      <span>{{ customer.name }}</span>
                    </button>
                  </th>
                  <td><a :href="`mailto:${customer.email}`">{{ customer.email }}</a></td>
                  <td>{{ customer.boughtOrBooked }}</td>
                  <td>{{ formatDate(customer.latestActivity) }}</td>
                </tr>
                <tr v-if="expandedCustomerIds.has(customer.id)" :id="customerHistoryId(customer.id)" class="customer-history-row">
                  <td colspan="4">
                    <ul class="customer-history" aria-label="Customer history">
                      <li v-for="activity in customer.activities" :key="activity.id">
                        <time :datetime="activity.activityAt">{{ formatDate(activity.activityAt) }}</time>
                        <strong>{{ activity.item }}</strong>
                        <span>{{ activity.siteName }}</span>
                        <span>{{ activity.amountCents == null || !activity.currency ? "—" : formatMoney(activity.amountCents, activity.currency) }}</span>
                        <span class="status-badge">{{ activityStatusLabel(activity.status) }}</span>
                      </li>
                    </ul>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>

          <table v-else class="accounts-table">
            <caption class="visually-hidden">{{ currentView === "income" ? "Income" : "Expenses" }} ledger</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Category</th><th scope="col">Project</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              <tr v-if="loading"><td colspan="8"><PageLoading compact label="Loading accounts..." /></td></tr>
              <tr v-else-if="entries.length === 0"><td colspan="8">No {{ entryType }} entries yet.</td></tr>
              <tr v-for="entry in entries" v-else :key="entry.id">
                <td>{{ formatDate(entry.date) }}</td>
                <th scope="row">{{ entry.description }}</th>
                <td>{{ entry.categoryName || "Uncategorized" }}</td>
                <td>{{ entry.projectName || "No project" }}</td>
                <td>{{ formatMoney(entry.amountCents, entry.currency) }}</td>
                <td><span class="status-badge">{{ statusLabel(entry.status) }}</span></td>
                <td>
                  <RouterLink v-if="entry.source === 'email_triage' && entry.sourceEmailId" class="accounts-source-link" :to="{ path: '/email', query: { message: entry.sourceEmailId } }">Email triage</RouterLink>
                  <span v-else>{{ sourceLabel(entry.source) }}</span>
                </td>
                <td>
                  <div class="accounts-table__row-actions">
                    <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Edit entry" @click="openEditEntry(entry)"><UiIcon name="Pencil" :size="15" /></Button>
                    <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Delete entry" @click="deleteEntry(entry)"><UiIcon name="Trash2" :size="15" /></Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="accounts-pagination">
          <span>{{ resultCountLabel }} · page {{ page }}</span>
          <div>
            <Button color="ghost" shape="soft" size="compact" icon-only :disabled="!hasPrevious" aria-label="Previous page" @click="changePage(-1)"><UiIcon name="ChevronLeft" :size="18" /></Button>
            <Button color="ghost" shape="soft" size="compact" icon-only :disabled="!hasNext" aria-label="Next page" @click="changePage(1)"><UiIcon name="ChevronRight" :size="18" /></Button>
          </div>
        </footer>
      </section>
    </div>

    <AppDialog :open="filtersOpen" labelled-by="accounts-filter-title" close-on-backdrop @close="filtersOpen = false">
      <form class="accounts-dialog" @submit.prevent="applyFilters">
        <header class="accounts-dialog__header"><h2 id="accounts-filter-title">{{ currentView === "customers" ? "Search customers" : "Search accounts" }}</h2><Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close filters" @click="filtersOpen = false"><UiIcon name="X" :size="18" /></Button></header>
        <div class="accounts-dialog__content">
          <label class="field"><span>Search</span><input v-model="search" type="search" :placeholder="currentView === 'customers' ? 'Name, email or item' : 'Search accounts'" /></label>
          <label v-if="currentView === 'customers'" class="field"><span>Product or service</span><select v-model="itemFilter"><option value="">All products and services</option><option v-for="item in customerItems" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
          <template v-else>
            <label class="field"><span>Status</span><select v-model="statusFilter"><option value="">Any status</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="needs_review">Needs review</option><option value="cancelled">Cancelled</option></select></label>
            <label class="field"><span>Source</span><select v-model="sourceFilter"><option value="">Any source</option><option value="manual">Manual</option><option value="csv_import">CSV import</option><option value="stripe">Stripe</option><option value="email_triage">Email triage</option></select></label>
          </template>
        </div>
        <footer class="accounts-dialog__actions"><Button color="ghost" shape="soft" size="compact" type="button" :disabled="!activeFilterCount" @click="clearFilters">Clear</Button><Button color="primary" shape="soft" size="compact" type="submit">Search</Button></footer>
      </form>
    </AppDialog>

    <AppDialog :open="entryDialogOpen" labelled-by="accounts-entry-title" close-on-backdrop @close="closeEntryDialog">
      <form class="accounts-dialog" @submit.prevent="saveEntry">
        <header class="accounts-dialog__header"><h2 id="accounts-entry-title">{{ editingEntryId ? "Edit account entry" : "Add account entry" }}</h2><Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="closeEntryDialog"><UiIcon name="X" :size="18" /></Button></header>
        <div class="accounts-dialog__content">
          <label class="field"><span>Date</span><input v-model="form.date" type="date" autofocus /></label>
          <div class="accounts-dialog__amount-grid">
            <label class="field"><span>Amount</span><input v-model="form.amount" type="number" min="0" step="0.01" placeholder="0.00" :disabled="editingStripeEntry" /></label>
            <label class="field"><span>Currency</span><select v-model="form.currency" :disabled="editingStripeEntry"><option v-for="option in currencyOptions" :key="option.value" :value="option.value">{{ option.value }}</option></select></label>
          </div>
          <label class="field"><span>Description</span><input v-model="form.description" type="text" autocomplete="off" /></label>
          <div class="accounts-dialog__grid">
            <label class="field"><span>Category</span><select v-model="form.categoryId"><option value="">Uncategorized</option><option v-for="category in categoryOptions" :key="category.id" :value="category.id">{{ category.name }}</option></select></label>
            <label class="field"><span>Status</span><select v-model="form.status" :disabled="editingStripeEntry"><option value="pending">Pending</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="needs_review">Needs review</option><option value="cancelled">Cancelled</option></select></label>
          </div>
          <label class="field"><span>Project</span><select v-model="form.projectId"><option value="">No project</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
          <p v-if="editingStripeEntry" class="accounts-dialog__hint">Stripe keeps the amount, currency and payment status in sync.</p>
          <label class="field"><span>Notes</span><textarea v-model="form.notes" rows="3" /></label>
          <p v-if="formError" class="accounts-error" role="alert">{{ formError }}</p>
        </div>
        <footer class="accounts-dialog__actions"><Button color="outline" shape="soft" size="compact" type="button" @click="closeEntryDialog">Cancel</Button><Button color="primary" shape="soft" size="compact" type="submit" :disabled="formDisabled">{{ saving ? "Saving..." : editingEntryId ? "Save changes" : "Add entry" }}</Button></footer>
      </form>
    </AppDialog>
  </main>
</template>

<style scoped>
.accounts-page { min-height: 100vh; min-height: 100dvh; padding: var(--workspace-topbar-padding-block) 24px 40px; background: var(--ui-bg); color: var(--ui-text); }
.accounts-workspace { display: grid; width: min(1120px, 100%); gap: 14px; margin: 0 auto; }
.accounts-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; min-height: var(--workspace-topbar-height); }
.accounts-tabs { display: grid; width: min(540px, 100%); grid-template-columns: repeat(3, 1fr); grid-column: 2; justify-self: center; padding: 3px; border-radius: 999px; background: var(--ui-surface-muted); }
.accounts-tabs button { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 14px; cursor: pointer; }
.accounts-tabs button:hover, .accounts-tabs button:focus-visible { color: var(--ui-text); outline: none; }
.accounts-tabs button:focus-visible { box-shadow: inset 0 0 0 2px var(--ui-focus); }
.accounts-tabs button.is-active { background: var(--ui-surface); color: var(--ui-text); font-weight: 750; box-shadow: var(--ui-shadow-sm); }
.accounts-toolbar__actions { position: relative; display: flex; grid-column: 3; justify-self: end; gap: 6px; }
.accounts-filter-count { position: absolute; top: 2px; right: 2px; display: grid; min-width: 14px; height: 14px; place-items: center; border-radius: 999px; background: var(--ui-accent); color: var(--ui-accent-contrast); font-size: 9px; font-weight: 800; }
.accounts-actions-menu { position: relative; }
.accounts-actions-menu summary { display: inline-grid; width: 34px; height: 34px; place-items: center; border-radius: var(--ui-radius-sm); color: var(--ui-text-muted); cursor: pointer; list-style: none; }
.accounts-actions-menu summary::-webkit-details-marker { display: none; }
.accounts-actions-menu summary:hover { background: var(--ui-surface-muted); color: var(--ui-text); }
.accounts-actions-menu__popover { position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; display: grid; min-width: 176px; gap: 3px; padding: 6px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.accounts-actions-menu__popover button { display: flex; min-height: 34px; align-items: center; gap: 8px; padding: 0 9px; border: 0; border-radius: var(--ui-radius-sm); background: transparent; color: var(--ui-text); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
.accounts-actions-menu__popover button:hover:not(:disabled) { background: var(--ui-surface-muted); }
.accounts-actions-menu__popover button:disabled { opacity: 0.5; cursor: not-allowed; }
.accounts-summary { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 18px; }
.accounts-summary div { display: grid; gap: 4px; min-width: 0; padding: 2px 0 8px; }
.accounts-summary span, .accounts-pagination span { color: var(--ui-text-muted); font-size: 12px; }
.accounts-summary strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.accounts-error { margin: 0; padding: 9px 11px; border-radius: var(--ui-radius-sm); background: var(--ui-danger-soft); color: var(--ui-danger); font-size: 13px; }
.accounts-workspace > section { display: grid; min-width: 0; gap: 14px; }
.accounts-table-wrap { min-width: 0; overflow-x: auto; }
.accounts-table { width: 100%; min-width: 980px; table-layout: fixed; border-collapse: collapse; border-top: 1px solid var(--ui-border); color: var(--ui-text-muted); font-size: 13px; }
.accounts-table th, .accounts-table td { overflow: hidden; padding: 10px 10px 10px 0; border-bottom: 1px solid var(--ui-border); text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.accounts-table thead th { color: var(--ui-text-muted); font-size: 12px; font-weight: 700; }
.accounts-table tbody th { color: var(--ui-text); font-weight: 700; }
.accounts-table th:nth-child(1) { width: 96px; }
.accounts-table th:nth-child(3), .accounts-table th:nth-child(4) { width: 128px; }
.accounts-table th:nth-child(5) { width: 112px; }
.accounts-table th:nth-child(6), .accounts-table th:nth-child(7) { width: 118px; }
.accounts-table th:nth-child(8) { width: 72px; }
.accounts-table--customers { min-width: 760px; }
.accounts-table--customers th:nth-child(1) { width: 26%; }
.accounts-table--customers th:nth-child(2) { width: 32%; }
.accounts-table--customers th:nth-child(3) { width: 25%; }
.accounts-table--customers th:nth-child(4) { width: 17%; }
.accounts-table a { color: inherit; text-decoration-color: var(--ui-border-strong); text-underline-offset: 3px; }
.accounts-source-link:hover, .accounts-source-link:focus-visible, .accounts-table a:hover, .accounts-table a:focus-visible { color: var(--ui-text); }
.accounts-table__row-actions { display: flex; justify-content: flex-end; gap: 4px; }
.status-badge { display: inline-flex; width: fit-content; padding: 2px 6px; border-radius: var(--ui-radius-sm); background: var(--ui-surface-muted); font-size: 12px; }
.customer-disclosure { display: inline-flex; max-width: 100%; min-height: 28px; align-items: center; gap: 6px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-weight: inherit; cursor: pointer; }
.customer-disclosure span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.customer-disclosure:focus-visible { border-radius: var(--ui-radius-sm); outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.customer-history-row td { padding: 0; background: var(--ui-surface-muted); white-space: normal; }
.customer-history { display: grid; margin: 0; padding: 4px 14px 8px 42px; list-style: none; }
.customer-history li { display: grid; grid-template-columns: 112px minmax(160px, 1fr) minmax(100px, .7fr) 112px 100px; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--ui-border); }
.customer-history li:last-child { border-bottom: 0; }
.customer-history time { color: var(--ui-text-muted); font-size: 12px; }
.customer-history strong { overflow: hidden; color: var(--ui-text); text-overflow: ellipsis; white-space: nowrap; }
.accounts-pagination { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.accounts-dialog { display: grid; width: min(520px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 48px)); overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg); background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.accounts-dialog__header, .accounts-dialog__actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; }
.accounts-dialog__header { border-bottom: 1px solid var(--ui-border); }
.accounts-dialog__header h2 { margin: 0; font-size: 16px; }
.accounts-dialog__actions { justify-content: flex-end; border-top: 1px solid var(--ui-border); }
.accounts-dialog__content { display: grid; gap: 14px; overflow-y: auto; padding: 18px 16px; }
.accounts-dialog__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.accounts-dialog__amount-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(110px, 1fr); gap: 12px; }
.accounts-dialog__hint { margin: -4px 0 0; color: var(--ui-text-muted); font-size: 12px; line-height: 1.45; }
.field { display: grid; gap: 6px; color: var(--ui-text); font-size: 13px; font-weight: 650; }
.field input, .field select, .field textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-bg); color: var(--ui-text); font: inherit; }
.field input, .field select { min-height: 40px; padding: 0 10px; }
.field textarea { resize: vertical; padding: 10px; line-height: 1.5; }
.field input:focus, .field select:focus, .field textarea:focus { outline: 2px solid var(--ui-focus); outline-offset: 1px; }
.field input:disabled, .field select:disabled { opacity: .7; cursor: not-allowed; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 959px) { .accounts-page { padding: var(--workspace-topbar-padding-block) 16px 32px; } }
@media (max-width: 640px) {
  .accounts-toolbar { grid-template-columns: 1fr auto; padding-left: var(--app-shell-mobile-nav-leading-padding); }
  .accounts-tabs { width: 100%; grid-row: 2; grid-column: 1 / -1; }
  .accounts-toolbar__actions { grid-row: 1; grid-column: 2; }
  .accounts-summary strong { overflow-wrap: anywhere; white-space: normal; }
  .accounts-dialog { width: 100vw; max-height: min(92vh, 92dvh); border-right: 0; border-bottom: 0; border-left: 0; border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; }
  .accounts-dialog__grid { grid-template-columns: 1fr; }
}
</style>
