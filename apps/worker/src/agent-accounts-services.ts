import type { AccountsEntryInput, AccountsEntryRecord, AgentAccountsServices } from "../../../packages/agent/src/tools/services";
import { AccountsInputError, createFinancialEntry, getFinancialEntry, listFinancialCategories, listFinancialEntries, updateFinancialEntry, type EntryType } from "./accounts";
import { getAccountsSummary } from "./accounts-summary";
import { createDriveFolder, listDriveFolders, uploadDriveFiles } from "./files";
import type { Env } from "./types";

type SerializedEntry = Awaited<ReturnType<typeof listFinancialEntries>>["entries"][number];
type ReceiptPhoto = { bytes: ArrayBuffer; sha256: string; mimeType: string };

const ENTRY_TYPES: EntryType[] = ["expense", "income"];
const RECEIPT_FOLDERS: Record<EntryType, string> = { expense: "Receipts", income: "Invoices" };
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Accounts for the assistant: read the books, log and correct entries, keep receipt photos in Files. */
export function createAgentAccountsServices(env: Env, ownerId: string): AgentAccountsServices {
  const categoryId = async (entryType: EntryType, name: string) => {
    const { categories } = await listFinancialCategories(env, ownerId, entryType);
    const match = categories.find((category) => category.name.toLowerCase() === name.trim().toLowerCase());
    if (!match) throw new AccountsInputError(`No ${entryType} category called "${name.trim()}". Use one of: ${categories.map((category) => category.name).join(", ")}.`);
    return match.id;
  };
  const payload = async (input: AccountsEntryInput, entryType: EntryType) => ({
    ...(input.amount === undefined ? {} : { amountCents: toCents(input.amount) }),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.date ? { date: input.date } : {}),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.status ? { status: input.status } : {}),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.category === undefined ? {} : { categoryId: input.category ? await categoryId(entryType, input.category) : null }),
  });
  const getEntry = async (entryId: string) => {
    const entry = await getFinancialEntry(env, ownerId, entryId);
    return entry ? toRecord(entry) : null;
  };

  return {
    async summary() {
      const [{ summary }, { categories }] = await Promise.all([getAccountsSummary(env, ownerId), listFinancialCategories(env, ownerId)]);
      const money = (side: { totals: Array<{ currency: string; amountCents: number }>; estimate: unknown }) => ({ totals: side.totals.map(formatTotal), estimate: formatEstimate(side.estimate) });
      return {
        defaultCurrency: summary.defaultCurrency,
        needsReview: summary.needsReview,
        periods: summary.periods.map((period: any) => ({ key: period.key, label: period.label, start: period.start, end: period.end, income: money(period.income), expenses: money(period.expenses), net: money(period.net) })),
        categories: Object.fromEntries(ENTRY_TYPES.map((entryType) => [entryType, categories.filter((category) => category.entryType === entryType).map((category) => category.name)])),
        note: "Totals count paid entries only. An estimate converts other currencies at ECB reference rates.",
      };
    },
    async listEntries(input) {
      const types = input.entryType ? [requireEntryType(input.entryType)] : ENTRY_TYPES;
      if (input.category?.trim() && !input.entryType) throw new AccountsInputError("Give entryType (income or expense) with a category.");
      const limit = Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 50);
      const pages = await Promise.all(types.map(async (entryType) => {
        const query = new URLSearchParams({ entryType, limit: String(limit), totals: "1" });
        if (input.dateFrom) query.set("dateFrom", input.dateFrom);
        if (input.dateTo) query.set("dateTo", input.dateTo);
        if (input.search?.trim()) query.set("search", input.search.trim());
        if (input.status) query.set("status", input.status);
        if (input.category?.trim()) query.set("categoryId", await categoryId(entryType, input.category));
        return listFinancialEntries(env, ownerId, query);
      }));
      const entries = pages.flatMap((page) => page.entries).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit).map(toRecord);
      // Income and expenses are never summed together; with both types the totals stay per type in the summary tool.
      const totals = types.length === 1 ? (pages[0].totals || []).map(formatTotal) : [];
      return { entries, total: pages.reduce((sum, page) => sum + page.total, 0), totals };
    },
    getEntry,
    async createEntry(input, scope) {
      const entryType = requireEntryType(input.entryType);
      const photo = scope.receiptAttachmentId ? await loadReceiptPhoto(env, ownerId, scope.threadId, scope.receiptAttachmentId) : null;
      if (photo) {
        const earlier = await env.DB.prepare(
          `SELECT r.entry_id FROM financial_entry_receipts r JOIN financial_entries e ON e.id = r.entry_id
           WHERE r.user_id = ? AND r.sha256 = ? ORDER BY r.created_at LIMIT 1`,
        ).bind(ownerId, photo.sha256).first<{ entry_id: string }>();
        const existing = earlier ? await getEntry(earlier.entry_id) : null;
        if (existing) return { entry: existing, duplicate: true };
      }
      const body = await payload(input, entryType);
      // A figure read off a photo can be wrong, so it waits for the owner's review.
      const created = await createFinancialEntry(env, ownerId, { ...body, entryType, status: photo ? "needs_review" : body.status || "paid" });
      if (!photo) return { entry: toRecord(created.entry) };
      try {
        const folder = await ensureReceiptFolder(env, ownerId, entryType);
        const form = new FormData();
        form.set("folderId", folder.id);
        form.set("onConflict", "rename");
        form.set("file", new File([photo.bytes], receiptFilename(created.entry.date, created.entry.description, photo.mimeType), { type: photo.mimeType }));
        const { files } = await uploadDriveFiles(env, ownerId, form);
        await env.DB.prepare("INSERT INTO financial_entry_receipts (entry_id, user_id, file_id, sha256) VALUES (?, ?, ?, ?)")
          .bind(created.entry.id, ownerId, files[0].id, photo.sha256).run();
        return { entry: { ...toRecord(created.entry), receiptFileId: files[0].id }, receipt: { saved: true, folder: folder.path } };
      } catch (error) {
        return { entry: toRecord(created.entry), receipt: { saved: false, reason: error instanceof Error ? error.message : "The photo could not be saved to Files." } };
      }
    },
    async updateEntry(entryId, patch) {
      const current = await getEntry(entryId);
      if (!current) throw new AccountsInputError("Entry not found", 404);
      const updated = await updateFinancialEntry(env, ownerId, entryId, await payload(patch, current.entryType));
      return { entry: toRecord(updated.entry) };
    },
  };
}

function requireEntryType(value: unknown): EntryType {
  if (value !== "income" && value !== "expense") throw new AccountsInputError("entryType must be income or expense");
  return value;
}

/** Decimal money to cents without binary float drift (19.99 * 100 is 1998.9999…). */
function toCents(amount: number): number {
  const cents = Math.round(Number((amount * 100).toFixed(4)));
  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents) || cents <= 0) throw new AccountsInputError("amount must be greater than zero");
  return cents;
}
const formatAmount = (cents: number) => (cents / 100).toFixed(2);
const formatTotal = (total: { currency: string; amountCents: number }) => ({ currency: total.currency, amount: formatAmount(total.amountCents) });
function formatEstimate(value: unknown) {
  const estimate = value as { status?: string; targetCurrency?: string; amountCents?: number } | null;
  if (!estimate || typeof estimate.amountCents !== "number") return estimate ? { status: estimate.status } : null;
  return { status: estimate.status, currency: estimate.targetCurrency, amount: formatAmount(estimate.amountCents) };
}

function toRecord(entry: SerializedEntry): AccountsEntryRecord {
  return {
    id: entry.id, entryType: entry.entryType, date: entry.date, description: entry.description, amount: formatAmount(entry.amountCents),
    currency: entry.currency, status: entry.status, category: entry.categoryName, source: entry.source, notes: entry.notes,
    customerName: entry.customerName, receiptFileId: entry.receiptFileId,
  };
}

/** Only a ready image the owner attached in this conversation can become a receipt. */
async function loadReceiptPhoto(env: Env, ownerId: string, threadId: string, attachmentId: string): Promise<ReceiptPhoto> {
  const unavailable = () => new AccountsInputError("That photo is not available in this conversation. Ask the owner to attach it again.");
  const asset = await env.DB.prepare(
    `SELECT storage_key, mime_type FROM assistant_attachments
     WHERE id = ? AND owner_id = ? AND thread_id = ? AND kind = 'image' AND status = 'ready'`,
  ).bind(attachmentId, ownerId, threadId).first<{ storage_key: string | null; mime_type: string }>();
  if (!asset?.storage_key || !env.SITE_ASSETS) throw unavailable();
  const object = await env.SITE_ASSETS.get(asset.storage_key);
  if (!object) throw unavailable();
  const bytes = await object.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { bytes, sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""), mimeType: asset.mime_type.toLowerCase() };
}

/**
 * Files > Receipts (expenses) or Files > Invoices (income), made on first use. Receipts is the
 * same top-level folder the phone apps' receipt scan already files into.
 */
async function ensureReceiptFolder(env: Env, ownerId: string, entryType: EntryType) {
  const name = RECEIPT_FOLDERS[entryType];
  const find = async () =>
    (await listDriveFolders(env, ownerId)).folders.find((folder) => !folder.parentId && folder.name.toLowerCase() === name.toLowerCase());
  const existing = await find();
  if (existing) return existing;
  // A parallel receipt can create the folder first; read it back rather than fail.
  try { return (await createDriveFolder(env, ownerId, { name })).folder; }
  catch (error) { const raced = await find(); if (raced) return raced; throw error; }
}

function receiptFilename(date: string, description: string, mimeType: string) {
  const label = description.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Receipt";
  return `${date.slice(0, 10)} ${label}.${EXTENSIONS[mimeType] || "jpg"}`;
}
