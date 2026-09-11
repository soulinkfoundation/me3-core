import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import AccountsPage from "./accounts.vue";

const route = reactive<{ query: Record<string, string> }>({ query: {} });
const router = vi.hoisted(() => ({ replace: vi.fn(async () => undefined) }));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => route,
  useRouter: () => router,
}));

vi.mock("../api", () => ({
  API_BASE: "/api",
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock("../composables/useAppToast", () => ({
  useAppToast: () => ({ toastFromUnknown: vi.fn(), toastSuccess: vi.fn() }),
}));

enableAutoUnmount(afterEach);

describe("Accounts page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.query = {};
  });

  it("keeps the selected customer view when an older income request finishes", async () => {
    const entries = deferred<{ entries: unknown[]; total: number }>();
    const categories = deferred<{ categories: unknown[] }>();
    const stats = deferred<{ stats: { defaultCurrency: string } }>();
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/accounts/entries?")) return entries.promise;
      if (endpoint.startsWith("/accounts/categories?")) return categories.promise;
      if (endpoint.startsWith("/accounts/stats?")) return stats.promise;
      if (endpoint.startsWith("/accounts/customers?")) {
        return {
          total: 1,
          items: [{ value: "product:course", label: "Gentle course" }],
          customers: [{
            id: "sam@example.com",
            name: "Sam",
            email: "sam@example.com",
            contactId: null,
            boughtOrBooked: "Gentle course",
            latestActivity: "2026-09-11 12:00:00",
            siteNames: ["sam"],
            activities: [{
              id: "purchase:order-1",
              kind: "purchase",
              item: "Gentle course",
              activityAt: "2026-09-11 12:00:00",
              amountCents: 2500,
              currency: "EUR",
              status: "paid",
              siteName: "sam",
            }],
          }],
        };
      }
      if (endpoint === "/accounts/stripe/status") return { connected: false };
      if (endpoint === "/mission-control/projects") return { projects: [] };
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const wrapper = mountPage();
    await wrapper.get("#accounts-tab-customers").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Sam");
    await wrapper.get(".customer-disclosure").trigger("click");
    expect(wrapper.get(".customer-disclosure").attributes("aria-expanded")).toBe("true");
    expect(wrapper.text()).toContain("€25.00");

    entries.resolve({ entries: [{ description: "Old income" }], total: 1 });
    categories.resolve({ categories: [] });
    stats.resolve({ stats: { defaultCurrency: "USD" } });
    await flushPromises();

    expect(wrapper.text()).toContain("Sam");
    expect(wrapper.text()).not.toContain("Old income");
  });

  it("uses a quiet add button and keeps currency beside amount as a select", async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint) => {
      if (endpoint.startsWith("/accounts/entries?")) return {
        total: 1,
        entries: [{
          id: "entry-1",
          date: "2026-09-11",
          description: "Receipt",
          categoryId: null,
          categoryName: null,
          projectId: null,
          projectName: null,
          amountCents: 1000,
          currency: "EUR",
          status: "needs_review",
          source: "email_triage",
          sourceEmailId: "message-1",
          notes: null,
        }],
      };
      if (endpoint.startsWith("/accounts/categories?")) return { categories: [] };
      if (endpoint.startsWith("/accounts/stats?")) return { stats: { defaultCurrency: "EUR" } };
      if (endpoint === "/accounts/stripe/status") return { connected: false };
      if (endpoint === "/mission-control/projects") return { projects: [] };
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });
    const wrapper = mountPage();
    await flushPromises();

    const add = wrapper.get('button[aria-label="Add entry"]');
    expect(add.classes()).not.toContain("me3-btn--primary");
    expect(wrapper.get(".accounts-source-link").attributes("href")).toBe("/email?message=message-1");
    await add.trigger("click");

    const amountGrid = wrapper.get(".accounts-dialog__amount-grid");
    expect(amountGrid.text()).toContain("Amount");
    expect(amountGrid.text()).toContain("Currency");
    expect(amountGrid.find("select").exists()).toBe(true);
  });
});

function mountPage() {
  return mount(AccountsPage, {
    attachTo: document.body,
    global: {
      stubs: {
        AppDialog: { props: ["open"], template: '<div v-if="open"><slot /></div>' },
        RouterLink: { props: ["to"], template: '<a :href="`/email?message=${to.query.message}`"><slot /></a>' },
      },
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
