import Stripe from "stripe";
import { getDefaultCommerceCurrency, getStripeSecretKey } from "./commerce-settings";
import type { Env } from "./types";
import { decodeMimeHeaderValue } from "../../../shared/email-headers";

export const ACCOUNTS_PLUGIN_ID = "me3.accounts";

export type EntryType = "income" | "expense";
type EntryStatus = "pending" | "paid" | "overdue" | "cancelled" | "needs_review";
type EntrySource = "manual" | "email_triage" | "stripe" | "csv_import";

type FinancialCategoryRow = {
  id: string;
  user_id: string;
  name: string;
  entry_type: EntryType;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type FinancialEntryRow = {
  id: string;
  user_id: string;
  entry_type: EntryType;
  date: string;
  description: string;
  category_id: string | null;
  category_name?: string | null;
  project_id: string | null;
  project_name?: string | null;
  amount_cents: number;
  currency: string;
  status: EntryStatus;
  source: EntrySource;
  notes: string | null;
  source_ref: string | null;
  source_email_id: string | null;
  stripe_charge_id: string | null;
  created_at: string;
  updated_at: string;
};

type CurrencyTotalRow = {
  currency: string | null;
  total: number;
};

export type AccountCustomerSourceRow = {
  activity_kind: "purchase" | "booking";
  source_id: string;
  customer_name: string;
  customer_email: string;
  item_key: string;
  item_label: string;
  activity_at: string;
  amount_cents: number | null;
  currency: string | null;
  status: string;
  site_id: string;
  site_name: string;
};

export type AccountCustomerContactRow = {
  id: string;
  name: string;
  email: string;
};

export class AccountsInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

const DEFAULT_CATEGORIES = {
  expense: [
    "Software",
    "Hosting",
    "Contractor",
    "Marketing",
    "Office",
    "Travel",
    "Professional Services",
    "Other",
  ],
  income: ["Bookings", "Consulting", "Product Sales", "Other"],
} as const satisfies Record<EntryType, readonly string[]>;

const ENTRY_TYPES = new Set<EntryType>(["income", "expense"]);
const ENTRY_STATUSES = new Set<EntryStatus>([
  "pending",
  "paid",
  "overdue",
  "cancelled",
  "needs_review",
]);
const ENTRY_SOURCES = new Set<EntrySource>(["manual", "email_triage", "stripe", "csv_import"]);
const CURRENCY_REGEX = /^[A-Z]{3}$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const STRIPE_SYNC_INITIAL_LOOKBACK_DAYS = 365;
const STRIPE_SYNC_OVERLAP_DAYS = 7;

export async function listFinancialEntries(env: Env, userId: string, query: URLSearchParams) {
  const entryType = parseEntryType(query.get("entryType"));
  if (!entryType) throw new AccountsInputError("entryType is required");

  const limit = parseInteger(query.get("limit"), 50, { min: 1, max: 100 });
  const offset = parseInteger(query.get("offset"), 0, { min: 0, max: 100000 });
  const search = query.get("search")?.trim() || null;
  const categoryId = query.get("categoryId")?.trim() || null;
  const status = parseEntryStatus(query.get("status"));
  const source = parseEntrySource(query.get("source"));
  if (query.get("status") && !status) throw new AccountsInputError("Invalid status filter");
  if (query.get("source") && !source) throw new AccountsInputError("Invalid source filter");

  const sortBy = query.get("sortBy") || "date";
  const sortDir = query.get("sortDir") === "asc" ? "ASC" : "DESC";
  const sortColumn =
    {
      date: "e.date",
      description: "LOWER(e.description)",
      amountCents: "e.amount_cents",
      status: "e.status",
      source: "e.source",
      createdAt: "e.created_at",
    }[sortBy] || "e.date";

  const { whereClause, params } = buildEntryFiltersSql({
    userId,
    entryType,
    search,
    categoryId,
    status,
    source,
  });
  const fromClause = `FROM financial_entries e
    LEFT JOIN financial_categories fc ON fc.id = e.category_id
    LEFT JOIN mission_projects mp ON mp.id = e.project_id AND mp.user_id = e.user_id`;

  const [entriesResult, countResult] = await Promise.all([
    env.DB.prepare(
      `SELECT e.id, e.user_id, e.entry_type, e.date, e.description, e.category_id,
              e.project_id, e.amount_cents, e.currency, e.status, e.source, e.notes, e.source_ref,
              e.source_email_id, e.stripe_charge_id, e.created_at, e.updated_at,
              fc.name AS category_name, mp.name AS project_name
       ${fromClause}
       ${whereClause}
       ORDER BY ${sortColumn} ${sortDir}, e.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all<FinancialEntryRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS count ${fromClause} ${whereClause}`)
      .bind(...params)
      .first<{ count: number }>(),
  ]);

  return {
    entries: (entriesResult.results || []).map(serializeEntry),
    total: countResult?.count || 0,
    limit,
    offset,
  };
}

export async function listAccountCustomers(env: Env, userId: string, query: URLSearchParams) {
  const limit = parseInteger(query.get("limit"), 50, { min: 1, max: 100 });
  const offset = parseInteger(query.get("offset"), 0, { min: 0, max: 100000 });
  const [activityResult, contactResult] = await Promise.all([
    env.DB.prepare(
      `SELECT 'purchase' AS activity_kind, o.id AS source_id,
              o.buyer_name AS customer_name, o.buyer_email AS customer_email,
              'product:' || o.product_slug AS item_key, o.product_title AS item_label,
              COALESCE(o.paid_at, o.created_at) AS activity_at,
              COALESCE(o.amount_paid, o.amount_due) AS amount_cents,
              UPPER(o.currency) AS currency, o.status,
              s.id AS site_id, s.username AS site_name
       FROM commerce_orders o
       INNER JOIN sites s ON s.id = o.site_id
       WHERE s.user_id = ?
         AND (o.status IN ('paid', 'refunded')
              OR (o.payment_method = 'manual' AND o.status = 'pending'))
       UNION ALL
       SELECT 'booking' AS activity_kind, b.id AS source_id,
              b.guest_name AS customer_name, b.guest_email AS customer_email,
              'booking:' || COALESCE(b.booking_type, 'booking') AS item_key,
              CASE b.booking_type
                WHEN 'one_to_one' THEN 'One-to-one booking'
                WHEN 'class' THEN 'Class booking'
                WHEN 'retreat' THEN 'Retreat booking'
                ELSE 'Booking'
              END AS item_label,
              COALESCE(b.paid_at, b.created_at) AS activity_at,
              COALESCE(b.amount_paid, b.suggested_amount) AS amount_cents,
              UPPER(b.currency) AS currency,
              CASE
                WHEN b.status = 'cancelled' THEN 'cancelled'
                WHEN b.is_free_booking = 1 THEN 'confirmed'
                WHEN b.payment_status = 'succeeded' THEN 'paid'
                WHEN b.suggested_amount IS NOT NULL THEN 'payment_due'
                ELSE 'confirmed'
              END AS status,
              s.id AS site_id, s.username AS site_name
       FROM bookings b
       INNER JOIN sites s ON s.id = b.site_id
       WHERE s.user_id = ? AND b.status IN ('confirmed', 'cancelled')
       ORDER BY activity_at DESC`,
    )
      .bind(userId, userId)
      .all<AccountCustomerSourceRow>(),
    env.DB.prepare(
      `SELECT id, name, email
       FROM contacts
       WHERE user_id = ? AND email IS NOT NULL AND status != 'archived'
       ORDER BY updated_at DESC`,
    )
      .bind(userId)
      .all<AccountCustomerContactRow>(),
  ]);

  return buildAccountCustomers(
    activityResult.results || [],
    contactResult.results || [],
    {
      search: query.get("search")?.trim() || "",
      item: query.get("item")?.trim() || "",
      limit,
      offset,
    },
  );
}

export function buildAccountCustomers(
  rows: AccountCustomerSourceRow[],
  contacts: AccountCustomerContactRow[],
  options: { search?: string; item?: string; limit?: number; offset?: number } = {},
) {
  const contactByEmail = new Map<string, AccountCustomerContactRow>();
  for (const contact of contacts) {
    const email = normalizeCustomerEmail(contact.email);
    if (email && !contactByEmail.has(email)) contactByEmail.set(email, contact);
  }

  const customersByEmail = new Map<
    string,
    {
      id: string;
      name: string;
      email: string;
      contactId: string | null;
      siteNames: Set<string>;
      itemKeys: Set<string>;
      activities: Array<{
        id: string;
        kind: "purchase" | "booking";
        itemKey: string;
        item: string;
        activityAt: string;
        amountCents: number | null;
        currency: string | null;
        status: string;
        siteId: string;
        siteName: string;
      }>;
    }
  >();
  const items = new Map<string, string>();

  // ponytail: this in-memory grouping suits a personal installation; move it to SQL if source rows become large.
  for (const row of rows) {
    const email = normalizeCustomerEmail(row.customer_email);
    if (!email) continue;
    const contact = contactByEmail.get(email);
    const customer = customersByEmail.get(email) || {
      id: email,
      name: contact?.name?.trim() || row.customer_name.trim() || email,
      email,
      contactId: contact?.id || null,
      siteNames: new Set<string>(),
      itemKeys: new Set<string>(),
      activities: [],
    };
    customer.siteNames.add(row.site_name);
    customer.itemKeys.add(row.item_key);
    customer.activities.push({
      id: `${row.activity_kind}:${row.source_id}`,
      kind: row.activity_kind,
      itemKey: row.item_key,
      item: row.item_label,
      activityAt: row.activity_at,
      amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
      currency: parseCurrency(row.currency),
      status: row.status,
      siteId: row.site_id,
      siteName: row.site_name,
    });
    customersByEmail.set(email, customer);
    items.set(row.item_key, row.item_label);
  }

  const search = options.search?.toLowerCase() || "";
  const item = options.item || "";
  const customers = [...customersByEmail.values()]
    .map((customer) => {
      customer.activities.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
      const purchases = customer.activities.filter((activity) => activity.kind === "purchase").length;
      const bookings = customer.activities.length - purchases;
      const summary = customer.activities.length === 1
        ? customer.activities[0].item
        : [
            purchases ? `${purchases} ${purchases === 1 ? "purchase" : "purchases"}` : "",
            bookings ? `${bookings} ${bookings === 1 ? "booking" : "bookings"}` : "",
          ].filter(Boolean).join(" · ");
      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        contactId: customer.contactId,
        boughtOrBooked: summary,
        latestActivity: customer.activities[0].activityAt,
        siteNames: [...customer.siteNames].sort(),
        activities: customer.activities,
        itemKeys: customer.itemKeys,
      };
    })
    .filter((customer) => !item || customer.itemKeys.has(item))
    .filter((customer) => {
      if (!search) return true;
      return [
        customer.name,
        customer.email,
        customer.boughtOrBooked,
        ...customer.siteNames,
        ...customer.activities.map((activity) => activity.item),
      ].some((value) => value.toLowerCase().includes(search));
    })
    .sort((a, b) => b.latestActivity.localeCompare(a.latestActivity));

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  return {
    customers: customers.slice(offset, offset + limit).map(({ itemKeys: _itemKeys, ...customer }) => customer),
    total: customers.length,
    limit,
    offset,
    items: [...items.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export async function createFinancialEntry(env: Env, userId: string, input: unknown) {
  const payload = parseEntryPayload(input);
  if (!payload?.entryType || !payload.date || !payload.description) {
    throw new AccountsInputError("entryType, date, and description are required");
  }
  if (payload.amountCents == null || payload.amountCents <= 0) {
    throw new AccountsInputError("amountCents must be a positive integer");
  }

  let categoryId: string | null = null;
  if (payload.categoryId) {
    const category = await getCategoryForUser(env, userId, payload.categoryId);
    if (!category || category.entry_type !== payload.entryType) {
      throw new AccountsInputError("Category does not match this entry type");
    }
    categoryId = category.id;
  }
  let projectId: string | null = null;
  if (payload.projectId) {
    const project = await getProjectForUser(env, userId, payload.projectId);
    if (!project) throw new AccountsInputError("Project not found", 404);
    projectId = project.id;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO financial_entries
       (id, user_id, entry_type, date, description, category_id, project_id, amount_cents,
        currency, status, source, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
  )
    .bind(
      id,
      userId,
      payload.entryType,
      payload.date,
      payload.description,
      categoryId,
      projectId,
      payload.amountCents,
      payload.currency || "USD",
      payload.status || "pending",
      payload.notes ?? null,
    )
    .run();

  return { entry: serializeEntry((await getEntryForUser(env, userId, id))!) };
}

export async function updateFinancialEntry(
  env: Env,
  userId: string,
  entryId: string,
  input: unknown,
) {
  const payload = parseEntryPayload(input);
  if (!payload) throw new AccountsInputError("Invalid request");
  const existing = await getEntryForUser(env, userId, entryId);
  if (!existing) throw new AccountsInputError("Entry not found", 404);

  const nextEntryType = payload.entryType || existing.entry_type;
  const nextDescription = payload.description || existing.description;
  const nextAmountCents = payload.amountCents ?? existing.amount_cents;
  if (!nextDescription.trim()) throw new AccountsInputError("Description is required");
  if (nextAmountCents <= 0) throw new AccountsInputError("amountCents must be a positive integer");

  let categoryId = existing.category_id;
  if (payload.categoryId !== undefined) {
    if (payload.categoryId === null) {
      categoryId = null;
    } else {
      const category = await getCategoryForUser(env, userId, payload.categoryId);
      if (!category || category.entry_type !== nextEntryType) {
        throw new AccountsInputError("Category does not match this entry type");
      }
      categoryId = category.id;
    }
  }
  let projectId = existing.project_id;
  if (payload.projectId !== undefined) {
    if (payload.projectId === null) {
      projectId = null;
    } else {
      const project = await getProjectForUser(env, userId, payload.projectId);
      if (!project) throw new AccountsInputError("Project not found", 404);
      projectId = project.id;
    }
  }

  await env.DB.prepare(
    `UPDATE financial_entries
     SET entry_type = ?, date = ?, description = ?, category_id = ?, project_id = ?,
         amount_cents = ?, currency = ?, status = ?, notes = ?,
         updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      nextEntryType,
      payload.date || existing.date,
      nextDescription.trim(),
      categoryId,
      projectId,
      nextAmountCents,
      payload.currency || existing.currency,
      payload.status || existing.status,
      payload.notes === undefined ? existing.notes : payload.notes,
      entryId,
      userId,
    )
    .run();

  return { entry: serializeEntry((await getEntryForUser(env, userId, entryId))!) };
}

export async function deleteFinancialEntry(env: Env, userId: string, entryId: string) {
  const result = await env.DB.prepare("DELETE FROM financial_entries WHERE id = ? AND user_id = ?")
    .bind(entryId, userId)
    .run();
  if (!result.success || (result.meta.changes ?? 0) === 0) {
    throw new AccountsInputError("Entry not found", 404);
  }
  return { ok: true };
}

export async function listFinancialCategories(
  env: Env,
  userId: string,
  entryTypeValue?: string | null,
) {
  const entryType = parseEntryType(entryTypeValue);
  await ensureDefaultCategories(env, userId, entryType ? [entryType] : ["expense", "income"]);

  const result = entryType
    ? await env.DB.prepare(
        `SELECT id, user_id, name, entry_type, sort_order, created_at, updated_at
         FROM financial_categories
         WHERE user_id = ? AND entry_type = ?
         ORDER BY sort_order ASC, name ASC`,
      )
        .bind(userId, entryType)
        .all<FinancialCategoryRow>()
    : await env.DB.prepare(
        `SELECT id, user_id, name, entry_type, sort_order, created_at, updated_at
         FROM financial_categories
         WHERE user_id = ?
         ORDER BY entry_type ASC, sort_order ASC, name ASC`,
      )
        .bind(userId)
        .all<FinancialCategoryRow>();

  return { categories: (result.results || []).map(serializeCategory) };
}

export async function createFinancialCategory(env: Env, userId: string, input: unknown) {
  const payload = parseCategoryPayload(input);
  if (!payload?.name || !payload.entryType) {
    throw new AccountsInputError("name and entryType are required");
  }

  try {
    const id = crypto.randomUUID();
    const sortOrder =
      payload.sortOrder ??
      ((await env.DB.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS current
         FROM financial_categories
         WHERE user_id = ? AND entry_type = ?`,
      )
        .bind(userId, payload.entryType)
        .first<{ current: number }>())?.current ?? -1) +
        1;

    await env.DB.prepare(
      `INSERT INTO financial_categories (id, user_id, name, entry_type, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, userId, payload.name, payload.entryType, sortOrder)
      .run();

    return { category: serializeCategory((await getCategoryForUser(env, userId, id))!) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create category";
    throw new AccountsInputError(
      message.includes("UNIQUE") ? "Category already exists" : message,
      message.includes("UNIQUE") ? 409 : 400,
    );
  }
}

export async function deleteFinancialCategory(env: Env, userId: string, categoryId: string) {
  const existing = await getCategoryForUser(env, userId, categoryId);
  if (!existing) throw new AccountsInputError("Category not found", 404);

  await env.DB.prepare(
    `UPDATE financial_entries
     SET category_id = NULL, updated_at = datetime('now')
     WHERE user_id = ? AND category_id = ?`,
  )
    .bind(userId, categoryId)
    .run();
  await env.DB.prepare("DELETE FROM financial_categories WHERE id = ? AND user_id = ?")
    .bind(categoryId, userId)
    .run();

  return { ok: true };
}

export async function exportFinancialEntriesCsv(
  env: Env,
  userId: string,
  query: URLSearchParams,
): Promise<Response> {
  const entryType = parseEntryType(query.get("entryType"));
  if (!entryType) throw new AccountsInputError("entryType is required");
  const status = parseEntryStatus(query.get("status"));
  const source = parseEntrySource(query.get("source"));
  if (query.get("status") && !status) throw new AccountsInputError("Invalid status filter");
  if (query.get("source") && !source) throw new AccountsInputError("Invalid source filter");

  const { whereClause, params } = buildEntryFiltersSql({
    userId,
    entryType,
    search: query.get("search")?.trim() || null,
    categoryId: query.get("categoryId")?.trim() || null,
    status,
    source,
  });
  const result = await env.DB.prepare(
    `SELECT e.date, e.description, COALESCE(fc.name, '') AS category_name,
            COALESCE(mp.name, '') AS project_name,
            e.amount_cents, e.currency, e.status, e.source, COALESCE(e.notes, '') AS notes
     FROM financial_entries e
     LEFT JOIN financial_categories fc ON fc.id = e.category_id
     LEFT JOIN mission_projects mp ON mp.id = e.project_id AND mp.user_id = e.user_id
     ${whereClause}
     ORDER BY e.date DESC, e.created_at DESC`,
  )
    .bind(...params)
    .all<{
      date: string;
      description: string;
      category_name: string;
      project_name: string;
      amount_cents: number;
      currency: string;
      status: EntryStatus;
      source: EntrySource;
      notes: string;
    }>();

  const csvRows = [["date", "description", "category", "project", "amount", "currency", "status", "source", "notes"].join(",")];
  for (const entry of result.results || []) {
    csvRows.push(
      [
        escapeCsv(entry.date),
        escapeCsv(entry.description),
        escapeCsv(entry.category_name),
        escapeCsv(entry.project_name),
        escapeCsv((entry.amount_cents / 100).toFixed(2)),
        escapeCsv(entry.currency),
        escapeCsv(entry.status),
        escapeCsv(entry.source),
        escapeCsv(entry.notes),
      ].join(","),
    );
  }

  const filename = `accounts-${entryType}-${new Date().toISOString().split("T")[0]}.csv`;
  return new Response(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function importFinancialEntriesCsv(
  env: Env,
  userId: string,
  formData: FormData,
) {
  const file = formData.get("file") as { text(): Promise<string> } | string | null;
  const entryType = parseEntryType(
    typeof formData.get("entryType") === "string" ? String(formData.get("entryType")) : null,
  );
  if (!file || typeof file === "string" || typeof file.text !== "function") {
    throw new AccountsInputError("CSV file is required");
  }
  if (!entryType) throw new AccountsInputError("entryType is required");

  await ensureDefaultCategories(env, userId, [entryType]);
  const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    throw new AccountsInputError("CSV must have a header row and at least one data row");
  }

  const headers = parseCsvLine(lines[0]).map(normalizeCsvHeader);
  const dateIndex = findHeaderIndex(headers, ["date", "transaction_date", "invoice_date", "paid_at"]);
  const descriptionIndex = findHeaderIndex(headers, ["description", "vendor", "merchant", "name", "title"]);
  const amountIndex = findHeaderIndex(headers, ["amount", "total", "value"]);
  const categoryIndex = findHeaderIndex(headers, ["category", "category_name", "label"]);
  const currencyIndex = findHeaderIndex(headers, ["currency", "currency_code"]);
  const statusIndex = findHeaderIndex(headers, ["status", "state"]);
  const notesIndex = findHeaderIndex(headers, ["notes", "note", "memo"]);
  if (dateIndex === -1 || descriptionIndex === -1 || amountIndex === -1) {
    throw new AccountsInputError("CSV must include date, description, and amount columns.");
  }

  let imported = 0;
  let skipped = 0;
  const errors: Array<{ row: number; reason: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const rowNumber = i + 1;
    const date = parseDateValue(values[dateIndex]);
    const description = values[descriptionIndex]?.trim();
    const amountCents = parseAmountToCents(values[amountIndex]);
    const currency = parseCurrency(values[currencyIndex] || "USD") || "USD";
    const status = parseCsvStatus(values[statusIndex], entryType);
    const notes = parseOptionalString(values[notesIndex]) ?? null;

    if (!date || !description || amountCents == null || !status) {
      skipped++;
      errors.push({
        row: rowNumber,
        reason: !date
          ? "Invalid or missing date"
          : !description
            ? "Description is required"
            : amountCents == null
              ? "Amount must be greater than zero"
              : "Invalid status value",
      });
      continue;
    }

    const categoryName = values[categoryIndex]?.trim();
    const category = categoryName
      ? await getOrCreateCategoryByName(env, userId, entryType, categoryName)
      : null;
    const sourceRef = `csv:${await sha256Text(
      [entryType, date, description.toLowerCase(), String(amountCents), currency].join("|"),
    )}`;

    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO financial_entries
         (id, user_id, entry_type, date, description, category_id, amount_cents,
          currency, status, source, notes, source_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv_import', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        entryType,
        date,
        description,
        category?.id || null,
        amountCents,
        currency,
        status,
        notes,
        sourceRef,
      )
      .run();

    if ((result.meta.changes ?? 0) > 0) imported++;
    else {
      skipped++;
      errors.push({ row: rowNumber, reason: "Duplicate entry already exists from a previous import" });
    }
  }

  return { ok: true, imported, skipped, total: lines.length - 1, errors };
}

export async function getFinancialStats(env: Env, userId: string, entryTypeValue: string | null) {
  const entryType = parseEntryType(entryTypeValue);
  if (!entryType) throw new AccountsInputError("entryType is required");
  const thisMonth = getMonthWindow(0);
  const lastMonth = getMonthWindow(-1);
  const [
    thisMonthTotalsResult,
    lastMonthTotalsResult,
    topCategoryResult,
    countResult,
    defaultCurrency,
  ] =
    await Promise.all([
      env.DB.prepare(
        `SELECT UPPER(currency) AS currency, COALESCE(SUM(amount_cents), 0) AS total
         FROM financial_entries
         WHERE user_id = ? AND entry_type = ? AND date >= ? AND date < ? AND status != 'cancelled'
         GROUP BY UPPER(currency)
         ORDER BY currency ASC`,
      )
        .bind(userId, entryType, thisMonth.start, thisMonth.end)
        .all<CurrencyTotalRow>(),
      env.DB.prepare(
        `SELECT UPPER(currency) AS currency, COALESCE(SUM(amount_cents), 0) AS total
         FROM financial_entries
         WHERE user_id = ? AND entry_type = ? AND date >= ? AND date < ? AND status != 'cancelled'
         GROUP BY UPPER(currency)
         ORDER BY currency ASC`,
      )
        .bind(userId, entryType, lastMonth.start, lastMonth.end)
        .all<CurrencyTotalRow>(),
      env.DB.prepare(
        `SELECT COALESCE(fc.name, 'Uncategorized') AS category_name,
                COALESCE(SUM(e.amount_cents), 0) AS total
         FROM financial_entries e
         LEFT JOIN financial_categories fc ON fc.id = e.category_id
         WHERE e.user_id = ? AND e.entry_type = ? AND e.date >= ? AND e.date < ? AND e.status != 'cancelled'
         GROUP BY COALESCE(fc.name, 'Uncategorized')
         ORDER BY total DESC, category_name ASC
         LIMIT 1`,
      )
        .bind(userId, entryType, thisMonth.start, thisMonth.end)
        .first<{ category_name: string; total: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM financial_entries WHERE user_id = ? AND entry_type = ?`,
      )
        .bind(userId, entryType)
        .first<{ count: number }>(),
      getDefaultCommerceCurrency(env, userId),
    ]);
  const thisMonthTotals = serializeCurrencyTotals(thisMonthTotalsResult.results);
  const lastMonthTotals = serializeCurrencyTotals(lastMonthTotalsResult.results);

  return {
    stats: {
      thisMonthCents: sumCurrencyTotals(thisMonthTotals),
      lastMonthCents: sumCurrencyTotals(lastMonthTotals),
      thisMonthTotals,
      lastMonthTotals,
      defaultCurrency,
      topCategoryName: topCategoryResult?.category_name || null,
      topCategoryTotalCents: topCategoryResult?.total || 0,
      entriesCount: countResult?.count || 0,
    },
  };
}

function serializeCurrencyTotals(rows: CurrencyTotalRow[] | undefined) {
  return (rows || [])
    .map((row) => ({
      currency: parseCurrency(row.currency) || "USD",
      amountCents: Number(row.total) || 0,
    }))
    .filter((row) => row.amountCents > 0);
}

function sumCurrencyTotals(totals: Array<{ amountCents: number }>) {
  return totals.reduce((sum, row) => sum + row.amountCents, 0);
}

export async function getAccountsStripeStatus(env: Env, userId: string) {
  const secretKey = await getStripeSecretKey(env, userId);
  const syncInfo = await env.DB.prepare(
    `SELECT MAX(updated_at) AS last_synced_at
     FROM financial_entries
     WHERE user_id = ? AND source = 'stripe'`,
  )
    .bind(userId)
    .first<{ last_synced_at: string | null }>();

  if (!secretKey) {
    return {
      connected: false,
      status: "not_configured",
      lastSyncedAt: syncInfo?.last_synced_at || null,
      syncReady: false,
    };
  }

  const stripe = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
  try {
    const account = await stripe.accounts.retrieve();
    return {
      connected: true,
      status: "configured",
      accountId: account.id,
      lastSyncedAt: syncInfo?.last_synced_at || null,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      defaultCurrency: account.default_currency?.toUpperCase() || null,
      syncReady: true,
    };
  } catch (error) {
    return {
      connected: true,
      status: "error",
      lastSyncedAt: syncInfo?.last_synced_at || null,
      syncReady: false,
      error: error instanceof Error ? error.message : "Could not verify Stripe key",
    };
  }
}

export async function syncAccountsStripe(env: Env, userId: string) {
  const secretKey = await getStripeSecretKey(env, userId);
  if (!secretKey) throw new AccountsInputError("Stripe is not configured in Account settings", 409);
  const stripe = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });

  const latestStripeEntry = await env.DB.prepare(
    `SELECT MAX(date) AS latest_date FROM financial_entries WHERE user_id = ? AND source = 'stripe'`,
  )
    .bind(userId)
    .first<{ latest_date: string | null }>();
  const syncStart = latestStripeEntry?.latest_date
    ? new Date(`${latestStripeEntry.latest_date}T00:00:00Z`)
    : new Date(Date.now() - STRIPE_SYNC_INITIAL_LOOKBACK_DAYS * 86400000);
  syncStart.setUTCDate(syncStart.getUTCDate() - STRIPE_SYNC_OVERLAP_DAYS);
  const createdGte = Math.max(0, Math.floor(syncStart.getTime() / 1000));

  let chargesImported = 0;
  let chargesUpdated = 0;
  let chargesSkipped = 0;
  let chargesProcessed = 0;
  let startingAfter: string | undefined;

  while (true) {
    const page = await stripe.charges.list({
      limit: 100,
      created: { gte: createdGte },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const charge of page.data) {
      chargesProcessed++;
      const status = buildStripeChargeStatus(charge);
      if (!status || charge.amount <= 0) {
        chargesSkipped++;
        continue;
      }
      const sourceRef = `stripe:${charge.id}`;
      const existing = await env.DB.prepare(
        `SELECT id FROM financial_entries WHERE user_id = ? AND source_ref = ? LIMIT 1`,
      )
        .bind(userId, sourceRef)
        .first<{ id: string }>();
      const date = new Date(charge.created * 1000).toISOString().slice(0, 10);
      const description = buildStripeDescription(charge);
      const currency = charge.currency.toUpperCase();
      const notes = buildStripeChargeNotes(charge);

      if (existing) {
        await env.DB.prepare(
          `UPDATE financial_entries
           SET date = ?, description = ?, amount_cents = ?, currency = ?, status = ?,
               notes = ?, stripe_charge_id = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
        )
          .bind(date, description, charge.amount, currency, status, notes, charge.id, existing.id, userId)
          .run();
        chargesUpdated++;
      } else {
        await env.DB.prepare(
          `INSERT INTO financial_entries
             (id, user_id, entry_type, date, description, category_id, amount_cents,
              currency, status, source, notes, source_ref, stripe_charge_id)
           VALUES (?, ?, 'income', ?, ?, NULL, ?, ?, ?, 'stripe', ?, ?, ?)`,
        )
          .bind(crypto.randomUUID(), userId, date, description, charge.amount, currency, status, notes, sourceRef, charge.id)
          .run();
        chargesImported++;
      }
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  return {
    ok: true,
    chargesImported,
    chargesUpdated,
    chargesSkipped,
    chargesProcessed,
    lastSyncedAt: new Date().toISOString(),
  };
}

function parseEntryType(value: string | undefined | null): EntryType | null {
  return value && ENTRY_TYPES.has(value as EntryType) ? (value as EntryType) : null;
}

function parseEntryStatus(value: string | undefined | null): EntryStatus | null {
  return value && ENTRY_STATUSES.has(value as EntryStatus) ? (value as EntryStatus) : null;
}

function parseEntrySource(value: string | undefined | null): EntrySource | null {
  return value && ENTRY_SOURCES.has(value as EntrySource) ? (value as EntrySource) : null;
}

function parseInteger(
  value: string | undefined | null,
  fallback: number,
  { min = 0, max = 100 }: { min?: number; max?: number } = {},
): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseDateValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (DATE_ONLY_REGEX.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return CURRENCY_REGEX.test(normalized) ? normalized : null;
}

function normalizeCustomerEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.includes("@") ? normalized : null;
}

function parseOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseEntryPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const amountValue =
    typeof input.amountCents === "number"
      ? input.amountCents
      : typeof input.amountCents === "string"
        ? Number.parseInt(input.amountCents, 10)
        : NaN;
  return {
    entryType: parseEntryType(typeof input.entryType === "string" ? input.entryType : null),
    date: parseDateValue(input.date),
    description: typeof input.description === "string" ? input.description.trim() : "",
    categoryId:
      typeof input.categoryId === "string" && input.categoryId.trim()
        ? input.categoryId.trim()
        : input.categoryId === null
          ? null
          : undefined,
    projectId:
      typeof input.projectId === "string" && input.projectId.trim()
        ? input.projectId.trim()
        : input.projectId === null
          ? null
          : undefined,
    amountCents: Number.isInteger(amountValue) ? amountValue : null,
    currency: input.currency === undefined ? undefined : parseCurrency(input.currency),
    status: input.status === undefined ? undefined : parseEntryStatus(typeof input.status === "string" ? input.status : null),
    notes: parseOptionalString(input.notes),
  };
}

function parseCategoryPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  return {
    name: typeof input.name === "string" ? input.name.trim() : "",
    entryType: input.entryType === undefined ? undefined : parseEntryType(typeof input.entryType === "string" ? input.entryType : null),
    sortOrder:
      typeof input.sortOrder === "number" && Number.isInteger(input.sortOrder)
        ? input.sortOrder
        : undefined,
  };
}

function buildEntryFiltersSql(filters: {
  userId: string;
  entryType: EntryType;
  search?: string | null;
  categoryId?: string | null;
  status?: EntryStatus | null;
  source?: EntrySource | null;
}) {
  const conditions = ["e.user_id = ?", "e.entry_type = ?"];
  const params: Array<string | number | null> = [filters.userId, filters.entryType];
  if (filters.search) {
    const pattern = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      `(LOWER(e.description) LIKE ? OR LOWER(COALESCE(e.notes, '')) LIKE ? OR LOWER(COALESCE(fc.name, '')) LIKE ? OR LOWER(COALESCE(mp.name, '')) LIKE ?)`,
    );
    params.push(pattern, pattern, pattern, pattern);
  }
  if (filters.categoryId) {
    conditions.push("e.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.status) {
    conditions.push("e.status = ?");
    params.push(filters.status);
  }
  if (filters.source) {
    conditions.push("e.source = ?");
    params.push(filters.source);
  }
  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
}

export async function ensureDefaultCategories(env: Env, userId: string, entryTypes: EntryType[]) {
  const statements = entryTypes.flatMap((entryType) =>
    DEFAULT_CATEGORIES[entryType].map((name, index) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO financial_categories (id, user_id, name, entry_type, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), userId, name, entryType, index),
    ),
  );
  if (statements.length > 0) await env.DB.batch(statements);
}

async function getCategoryForUser(env: Env, userId: string, categoryId: string) {
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, name, entry_type, sort_order, created_at, updated_at
       FROM financial_categories
       WHERE id = ? AND user_id = ?`,
    )
      .bind(categoryId, userId)
      .first<FinancialCategoryRow>()) || null
  );
}

async function getProjectForUser(env: Env, userId: string, projectId: string) {
  return (
    (await env.DB.prepare(
      `SELECT id
       FROM mission_projects
       WHERE id = ? AND user_id = ? AND status != 'archived'`,
    )
      .bind(projectId, userId)
      .first<{ id: string }>()) || null
  );
}

async function getEntryForUser(env: Env, userId: string, entryId: string) {
  return (
    (await env.DB.prepare(
      `SELECT e.id, e.user_id, e.entry_type, e.date, e.description, e.category_id,
              e.project_id, e.amount_cents, e.currency, e.status, e.source, e.notes, e.source_ref,
              e.source_email_id, e.stripe_charge_id, e.created_at, e.updated_at,
              fc.name AS category_name, mp.name AS project_name
       FROM financial_entries e
       LEFT JOIN financial_categories fc ON fc.id = e.category_id
       LEFT JOIN mission_projects mp ON mp.id = e.project_id AND mp.user_id = e.user_id
       WHERE e.id = ? AND e.user_id = ?`,
    )
      .bind(entryId, userId)
      .first<FinancialEntryRow>()) || null
  );
}

export async function getOrCreateCategoryByName(
  env: Env,
  userId: string,
  entryType: EntryType,
  name: string,
) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lookup = `SELECT id, user_id, name, entry_type, sort_order, created_at, updated_at
    FROM financial_categories
    WHERE user_id = ? AND entry_type = ? AND name = ? COLLATE NOCASE`;
  const existing = await env.DB.prepare(lookup)
    .bind(userId, entryType, trimmed)
    .first<FinancialCategoryRow>();
  if (existing) return existing;

  const sortOrder =
    ((await env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS current
       FROM financial_categories
       WHERE user_id = ? AND entry_type = ?`,
    )
      .bind(userId, entryType)
      .first<{ current: number }>())?.current ?? -1) + 1;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO financial_categories (id, user_id, name, entry_type, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, trimmed, entryType, sortOrder)
    .run();
  return env.DB.prepare(lookup).bind(userId, entryType, trimmed).first<FinancialCategoryRow>();
}

function serializeCategory(category: FinancialCategoryRow) {
  return {
    id: category.id,
    userId: category.user_id,
    name: category.name,
    entryType: category.entry_type,
    sortOrder: category.sort_order,
    createdAt: category.created_at,
    updatedAt: category.updated_at,
  };
}

function serializeEntry(entry: FinancialEntryRow) {
  return {
    id: entry.id,
    userId: entry.user_id,
    entryType: entry.entry_type,
    date: entry.date,
    description: decodeMimeHeaderValue(entry.description),
    categoryId: entry.category_id,
    categoryName: entry.category_name || null,
    projectId: entry.project_id,
    projectName: entry.project_name || null,
    amountCents: entry.amount_cents,
    currency: entry.currency,
    status: entry.status,
    source: entry.source,
    notes: entry.notes,
    sourceRef: entry.source_ref,
    sourceEmailId: entry.source_email_id,
    stripeChargeId: entry.stripe_charge_id,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

function normalizeCsvHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  const normalizedAliases = aliases.map(normalizeCsvHeader);
  return headers.findIndex((header) => normalizedAliases.includes(header));
}

function parseAmountToCents(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/,/g, "")
    .replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  const cents = Math.round(parsed * 100);
  return cents > 0 ? cents : null;
}

function parseCsvStatus(value: string | undefined, entryType: EntryType): EntryStatus | null {
  if (!value?.trim()) return entryType === "income" ? "paid" : "pending";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "review" || normalized === "flagged") return "needs_review";
  return parseEntryStatus(normalized);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function escapeCsv(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getMonthWindow(offsetMonths = 0) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function buildStripeDescription(charge: Stripe.Charge): string {
  return (
    charge.description ||
    charge.metadata?.product_name ||
    charge.metadata?.productName ||
    charge.metadata?.item_name ||
    charge.statement_descriptor ||
    charge.billing_details?.name ||
    "Stripe payment"
  );
}

function buildStripeChargeStatus(charge: Stripe.Charge): EntryStatus | null {
  if (charge.refunded || charge.disputed) return "needs_review";
  if (charge.status === "succeeded") return "paid";
  if (charge.status === "pending") return "pending";
  return null;
}

function buildStripeChargeNotes(charge: Stripe.Charge): string | null {
  const notes: string[] = [];
  if (charge.refunded) notes.push("Refunded in Stripe");
  if (charge.disputed) notes.push("Charge marked as disputed in Stripe");
  return notes.length > 0 ? notes.join(". ") : null;
}
