import { describe, expect, it } from "vitest";
import {
  AccountsInputError,
  buildAccountCustomers,
  buildStripeChargeSnapshot,
  createFinancialEntry,
  getFinancialStats,
  parseCsvRows,
  updateFinancialEntry,
} from "./accounts";
import type Stripe from "stripe";
import type { AccountCustomerSourceRow } from "./accounts";
import type { Env } from "./types";

type TestEntry = {
  user_id: string;
  entry_type: "income" | "expense";
  date: string;
  amount_cents: number;
  currency: string;
  status: string;
};

type StoredProject = {
  id: string;
  user_id: string;
  name: string;
  status: string;
};

type StoredFinancialEntry = {
  id: string;
  user_id: string;
  entry_type: "income" | "expense";
  date: string;
  description: string;
  category_id: string | null;
  project_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  source: string;
  notes: string | null;
  source_ref: string | null;
  source_email_id: string | null;
  stripe_charge_id: string | null;
  created_at: string;
  updated_at: string;
};

describe("accounts stats", () => {
  it("keeps monthly totals separated by currency", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const env = {
      DB: new AccountsStatsDb([
        entry({ date: today, amount_cents: 500, currency: "USD" }),
        entry({ date: today, amount_cents: 500, currency: "EUR" }),
        entry({ date: today, amount_cents: 900, currency: "USD", status: "pending" }),
        entry({
          date: today,
          amount_cents: 500,
          currency: "EUR",
          status: "cancelled",
        }),
      ]),
    } as unknown as Env;

    const result = await getFinancialStats(env, "owner", "expense");

    expect(result.stats.thisMonthCents).toBe(1000);
    expect(result.stats.thisMonthTotals).toEqual([
      { currency: "EUR", amountCents: 500 },
      { currency: "USD", amountCents: 500 },
    ]);
    expect(result.stats.defaultCurrency).toBe("USD");
  });
});

describe("account entries", () => {
  it("links manual entries to projects and can clear the link", async () => {
    const env = {
      DB: new AccountsEntriesDb([
        {
          id: "project-1",
          user_id: "owner",
          name: "ME3",
          status: "active",
        },
      ]),
    } as unknown as Env;

    const created = await createFinancialEntry(env, "owner", {
      entryType: "expense",
      date: "2026-06-24",
      description: "Hosting",
      amountCents: 500,
      projectId: "project-1",
    });

    expect(created.entry.projectId).toBe("project-1");
    expect(created.entry.projectName).toBe("ME3");

    const updated = await updateFinancialEntry(env, "owner", created.entry.id, {
      projectId: null,
    });

    expect(updated.entry.projectId).toBeNull();
    expect(updated.entry.projectName).toBeNull();
  });

  it("rejects invalid supplied values instead of retaining old data", async () => {
    const env = { DB: new AccountsEntriesDb([]) } as unknown as Env;
    await expect(createFinancialEntry(env, "owner", {
      entryType: "income",
      date: "2026-02-30",
      description: "Impossible date",
      amountCents: "10.5",
    })).rejects.toBeInstanceOf(AccountsInputError);
  });
});

describe("account imports and Stripe payment truth", () => {
  it("parses exported multiline CSV fields", () => {
    expect(parseCsvRows('date,notes\r\n2026-09-11,"Line one\nLine ""two"""')).toEqual([
      ["date", "notes"],
      ["2026-09-11", 'Line one\nLine "two"'],
    ]);
  });

  it("uses net collected value for partial refunds and excludes full refunds", () => {
    const partial = buildStripeChargeSnapshot(stripeCharge({ amount_refunded: 250 }));
    expect(partial).toMatchObject({
      grossAmountCents: 1000,
      refundedAmountCents: 250,
      netAmountCents: 750,
      status: "paid",
      paymentIntentId: "pi_123",
    });
    expect(buildStripeChargeSnapshot(stripeCharge({ amount_refunded: 1000 }))).toMatchObject({
      netAmountCents: 0,
      status: "needs_review",
    });
    expect(buildStripeChargeSnapshot(stripeCharge({ disputed: true }))).toMatchObject({
      status: "needs_review",
    });
  });
});

describe("account customers", () => {
  it("groups repeat website activity by email and keeps filtering separate from history", () => {
    const rows: AccountCustomerSourceRow[] = [
      customerActivity({
        activity_kind: "purchase",
        source_id: "order-1",
        customer_name: "Kieran",
        customer_email: " KIERAN@example.com ",
        item_key: "product:course",
        item_label: "Gentle course",
        activity_at: "2026-09-10 12:00:00",
        amount_cents: 2500,
        currency: "EUR",
        status: "paid",
      }),
      customerActivity({
        activity_kind: "booking",
        source_id: "booking-1",
        customer_name: "Kieran Butler",
        customer_email: "kieran@example.com",
        item_key: "booking:coaching",
        item_label: "One-to-one booking",
        activity_at: "2026-09-11 12:00:00",
        amount_cents: null,
        currency: null,
        status: "confirmed",
      }),
      customerActivity({
        source_id: "order-2",
        customer_name: "Someone Else",
        customer_email: "someone@example.com",
        item_key: "product:book",
        item_label: "Book",
      }),
    ];

    const result = buildAccountCustomers(
      rows,
      [{ id: "contact-1", name: "Kieran B", email: "kieran@example.com" }],
      { item: "product:course", limit: 50, offset: 0 },
    );

    expect(result.total).toBe(1);
    expect(result.customers[0]).toMatchObject({
      name: "Kieran B",
      email: "kieran@example.com",
      contactId: "contact-1",
      boughtOrBooked: "1 purchase · 1 booking",
      latestActivity: "2026-09-11 12:00:00",
    });
    expect(result.customers[0].activities).toHaveLength(2);
    expect(result.items).toEqual([
      { value: "product:book", label: "Book" },
      { value: "product:course", label: "Gentle course" },
      { value: "booking:coaching", label: "One-to-one booking" },
    ]);
  });
});

function customerActivity(
  overrides: Partial<AccountCustomerSourceRow>,
): AccountCustomerSourceRow {
  return {
    activity_kind: "purchase",
    source_id: "order",
    customer_name: "Customer",
    customer_email: "customer@example.com",
    item_key: "product:item",
    item_label: "Item",
    activity_at: "2026-09-01 12:00:00",
    amount_cents: 1000,
    currency: "USD",
    status: "paid",
    site_id: "site-1",
    site_name: "kieran",
    ...overrides,
  };
}

function entry(overrides: Partial<TestEntry>): TestEntry {
  return {
    user_id: "owner",
    entry_type: "expense",
    date: "2026-06-01",
    amount_cents: 100,
    currency: "USD",
    status: "paid",
    ...overrides,
  };
}

class AccountsStatsDb {
  constructor(private readonly entries: TestEntry[]) {}

  prepare(sql: string) {
    return new AccountsStatsStatement(sql, this.entries);
  }
}

class AccountsStatsStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly entries: TestEntry[],
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    if (!this.sql.includes("GROUP BY UPPER(currency)")) return { results: [] as T[] };
    const totals = new Map<string, number>();
    for (const entry of this.filteredEntries()) {
      const currency = entry.currency.toUpperCase();
      totals.set(currency, (totals.get(currency) || 0) + entry.amount_cents);
    }
    return {
      results: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, total]) => ({ currency, total })) as T[],
    };
  }

  async first<T>() {
    if (this.sql.includes("COUNT(*) AS count")) {
      const [userId, entryType] = this.values;
      return {
        count: this.entries.filter(
          (entry) => entry.user_id === userId && entry.entry_type === entryType,
        ).length,
      } as T;
    }
    return null as T | null;
  }

  private filteredEntries() {
    const [userId, entryType, start, end] = this.values as string[];
    return this.entries.filter(
      (entry) =>
        entry.user_id === userId &&
        entry.entry_type === entryType &&
        entry.date >= start &&
        entry.date < end &&
        entry.status === "paid",
    );
  }
}

function stripeCharge(overrides: Partial<Stripe.Charge> = {}): Stripe.Charge {
  return {
    id: "ch_123",
    amount: 1000,
    amount_refunded: 0,
    billing_details: { name: "Buyer", email: "buyer@example.com" },
    created: 1_757_500_000,
    currency: "eur",
    disputed: false,
    payment_intent: "pi_123",
    receipt_email: null,
    refunded: false,
    status: "succeeded",
    metadata: {},
    ...overrides,
  } as Stripe.Charge;
}

class AccountsEntriesDb {
  readonly entries: StoredFinancialEntry[] = [];

  constructor(private readonly projects: StoredProject[]) {}

  prepare(sql: string) {
    return new AccountsEntriesStatement(sql, this.entries, this.projects);
  }
}

class AccountsEntriesStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly entries: StoredFinancialEntry[],
    private readonly projects: StoredProject[],
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM mission_projects")) {
      const [id, userId] = this.values;
      return (
        (this.projects.find(
          (project) =>
            project.id === id &&
            project.user_id === userId &&
            project.status !== "archived",
        ) as T) || null
      );
    }

    if (this.sql.includes("FROM financial_entries e")) {
      const [id, userId] = this.values;
      const entry = this.entries.find(
        (row) => row.id === id && row.user_id === userId,
      );
      if (!entry) return null;
      const project = this.projects.find(
        (item) => item.id === entry.project_id && item.user_id === entry.user_id,
      );
      return {
        ...entry,
        category_name: null,
        project_name: project?.name || null,
      } as T;
    }

    return null;
  }

  async run() {
    if (this.sql.includes("INSERT INTO financial_entries")) {
      const [
        id,
        userId,
        entryType,
        date,
        description,
        categoryId,
        projectId,
        amountCents,
        currency,
        status,
        notes,
      ] = this.values;
      this.entries.push({
        id: id as string,
        user_id: userId as string,
        entry_type: entryType as "income" | "expense",
        date: date as string,
        description: description as string,
        category_id: (categoryId as string | null) || null,
        project_id: (projectId as string | null) || null,
        amount_cents: amountCents as number,
        currency: currency as string,
        status: status as string,
        source: "manual",
        notes: (notes as string | null) || null,
        source_ref: null,
        source_email_id: null,
        stripe_charge_id: null,
        created_at: "2026-06-24 12:00:00",
        updated_at: "2026-06-24 12:00:00",
      });
      return { meta: { changes: 1 }, success: true };
    }

    if (this.sql.includes("UPDATE financial_entries")) {
      const [
        entryType,
        date,
        description,
        categoryId,
        projectId,
        amountCents,
        currency,
        status,
        notes,
        id,
        userId,
      ] = this.values;
      const entry = this.entries.find(
        (row) => row.id === id && row.user_id === userId,
      );
      if (!entry) return { meta: { changes: 0 }, success: false };
      entry.entry_type = entryType as "income" | "expense";
      entry.date = date as string;
      entry.description = description as string;
      entry.category_id = (categoryId as string | null) || null;
      entry.project_id = (projectId as string | null) || null;
      entry.amount_cents = amountCents as number;
      entry.currency = currency as string;
      entry.status = status as string;
      entry.notes = (notes as string | null) || null;
      entry.updated_at = "2026-06-24 12:01:00";
      return { meta: { changes: 1 }, success: true };
    }

    return { meta: { changes: 0 }, success: false };
  }
}
