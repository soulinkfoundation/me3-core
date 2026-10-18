import type { AgentTool, AgentToolContext, AgentToolResult } from "../types";
import { objectSchema, ok, requiredString, services } from "./common";
import type { NetworkSellerRef } from "./services";

const MAX_EMAIL_READ_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PROFILE_READ_AGE_MS = 24 * 60 * 60 * 1000;
const NETWORK_HOW_IT_WORKS = "After you approve, ME3 asks the seller to hold it for 15 minutes and gives you their secure checkout. You pay on your own device; ME3 never sees your card details.";

type IndexedOffering = { id?: unknown; url?: unknown; agentCheckout?: { specUrl?: unknown } | null };
/**
 * The seller and offering as core_people_search returned them in this conversation.
 * Only the index's agent checkout spec URL is ever called, never a model-written address.
 */
async function rememberedSeller(context: AgentToolContext, profileId: string, offeringId: string): Promise<{ seller: NetworkSellerRef | null; fallbackUrl: string | null }> {
  const row = await context.db.prepare("SELECT snapshot_json, read_at FROM me3_agent_targets WHERE owner_id=? AND thread_id=? AND domain='public profile' AND record_id=?")
    .bind(context.ownerId, context.threadId, profileId).first<{ snapshot_json: string; read_at: string }>();
  if (!row || Date.now() - Date.parse(row.read_at) > MAX_PROFILE_READ_AGE_MS) throw new Error("Find this seller with core_people_search first, then use its stable profileId.");
  const profile = JSON.parse(row.snapshot_json) as { name?: unknown; handle?: unknown; profileUrl?: unknown; publicUrl?: unknown; offerings?: IndexedOffering[] };
  const offering = (Array.isArray(profile.offerings) ? profile.offerings : []).find(candidate => candidate?.id === offeringId);
  if (!offering) throw new Error("That offering is not one this seller listed. Use an offering id from core_people_search.");
  const pageUrl = [offering.url, profile.publicUrl, profile.profileUrl].find((value): value is string => typeof value === "string" && value.startsWith("https://")) ?? null;
  const specUrl = typeof offering.agentCheckout?.specUrl === "string" ? offering.agentCheckout.specUrl : null;
  if (!specUrl) return { seller: null, fallbackUrl: pageUrl };
  return { seller: { profileId, name: typeof profile.name === "string" ? profile.name : "Seller", handle: typeof profile.handle === "string" ? profile.handle : null,
    profileUrl: typeof profile.profileUrl === "string" ? profile.profileUrl : null, specUrl, offeringUrl: typeof offering.url === "string" ? offering.url : null }, fallbackUrl: pageUrl };
}

const amountProperty = (description: string) => ({ type: "string", pattern: "^\\d{1,9}(\\.\\d{1,3})?$", description });

function paymentTool(tool: Omit<AgentTool, "execute"> & { run(args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult> }): AgentTool {
  const { run, ...definition } = tool;
  return {
    ...definition,
    async execute(args, context) {
      try {
        const properties = definition.parameters.properties as Record<string, unknown>;
        for (const key of Object.keys(args)) if (!(key in properties)) throw new Error(`Undeclared argument ${key}.`);
        if (!services(context).payments) throw new Error("Payments are unavailable.");
        context.signal.throwIfAborted();
        return await run(args, context);
      } catch (error) {
        return { status: "error", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/**
 * ME3 never charges the owner. It proposes an exact purchase, the owner approves it
 * with a fresh sign-in, and the owner pays on their own device. Approval cannot be
 * granted from chat text; the worker requires the approvals endpoint for payments.
 */
export function paymentTools(): AgentTool[] {
  const propose = paymentTool({
    name: "core_payments_propose",
    description: "Propose an exact purchase for the owner to approve and then pay on their own device. Use only after confirming the merchant, items and total from the merchant's own page. ME3 never charges; after approval it gives the owner the checkout link.",
    parameters: objectSchema({
      merchantName: { type: "string", minLength: 1, maxLength: 200 },
      merchantUrl: { type: "string", description: "The merchant's public https page for this purchase." },
      purpose: { type: "string", minLength: 1, maxLength: 500, description: "Why the owner is buying this, in their words." },
      items: { type: "array", minItems: 1, maxItems: 20, items: objectSchema({ name: { type: "string", minLength: 1, maxLength: 200 }, quantity: { type: "integer", minimum: 1, maximum: 999 }, options: { type: "string", maxLength: 300, description: "Size, colour, date or other chosen options." } }, ["name", "quantity"]) },
      amount: amountProperty("Expected total as a decimal string, e.g. \"24.99\", including delivery and fees shown by the merchant."),
      currency: { type: "string", pattern: "^[A-Za-z]{3}$", description: "ISO 4217 code such as EUR or GBP." },
      checkoutUrl: { type: "string", description: "Optional https cart or checkout link the owner can open to pay, such as a Shopify cart link." },
      refundPolicy: { type: "string", maxLength: 500, description: "Optional refund or cancellation terms shown by the merchant." },
    }, ["merchantName", "merchantUrl", "purpose", "items", "amount", "currency"]),
    effect: "external", approval: "required", pluginId: null,
    async run(args, context) {
      const payments = services(context).payments!;
      const proposal = await payments.propose(args, { threadId: context.threadId, turnId: context.turnId, idempotencyKey: context.idempotencyKey });
      if (!context.approved) {
        const limits = await payments.limits(proposal.currency);
        return { status: "needs_approval", approval: {
          title: "Approve payment", summary: `${proposal.amount} ${proposal.currency} to ${proposal.merchant.name}`,
          kind: "payment", requiresFreshAuthentication: true, proposalId: proposal.id, proposalHash: proposal.proposalHash,
          merchant: proposal.merchant, purpose: proposal.purpose, items: proposal.items, amount: proposal.amount, currency: proposal.currency,
          amountMinor: proposal.amountMinor, method: proposal.method, checkoutUrl: proposal.checkoutUrl, checkoutDomainDiffers: proposal.checkoutDomainDiffers,
          refundPolicy: proposal.refundPolicy, limits,
          howItWorks: "You pay on your own device. ME3 does not charge you and never sees your card details.",
        } };
      }
      const approved = context.approvalData;
      if (approved?.proposalId !== proposal.id || approved?.proposalHash !== proposal.proposalHash) throw new Error("This approval does not match the reviewed payment proposal.");
      const result = await payments.handOver(proposal.id, proposal.proposalHash);
      return ok({ ...result, next: "Give the owner the openUrl and instructions. Do not say the payment is complete: the owner pays on their own device. Later, record the receipt from the merchant's order email or ask the owner to confirm." });
    },
  });

  const recordReceipt = paymentTool({
    name: "core_payments_record_receipt",
    description: "Record what the owner actually paid for an approved payment, from the merchant's order confirmation email that you read in the mailbox.",
    parameters: objectSchema({
      paymentId: { type: "string", minLength: 1, description: "Stable payment ID from core_payments_list or the approval." },
      orderEmailId: { type: "string", minLength: 1, description: "Stable mailbox message ID of the order confirmation you read." },
      amount: amountProperty("Total charged according to the email, as a decimal string."),
      currency: { type: "string", pattern: "^[A-Za-z]{3}$" },
      orderReference: { type: "string", maxLength: 200 },
      paidAt: { type: "string", description: "ISO date-time of the order, if the email shows it." },
    }, ["paymentId", "orderEmailId", "amount", "currency"]),
    effect: "write", approval: "none", pluginId: null,
    async run(args, context) {
      const emailId = requiredString(args.orderEmailId, "Order email ID");
      // The receipt must cite an order email actually read in this conversation.
      const read = await context.db.prepare("SELECT read_at FROM me3_agent_targets WHERE owner_id=? AND thread_id=? AND domain='mailbox message' AND record_id=?")
        .bind(context.ownerId, context.threadId, emailId).first<{ read_at: string }>();
      if (!read || Date.now() - Date.parse(read.read_at) > MAX_EMAIL_READ_AGE_MS) throw new Error("Read the order confirmation email first, then use its stable ID.");
      const payment = await services(context).payments!.recordReceipt({ proposalId: args.paymentId, amount: args.amount, currency: args.currency, orderReference: args.orderReference, paidAt: args.paidAt, sourceMessageId: emailId });
      return ok({ payment, next: payment.receipt && (payment.receipt as { mismatch?: boolean }).mismatch ? "Tell the owner the amount charged differs from what they approved." : "Tell the owner the receipt was saved." });
    },
  });

  const list = paymentTool({
    name: "core_payments_list",
    description: "List the owner's recent payment proposals, hand-overs and receipts, newest first.",
    parameters: objectSchema({
      status: { type: "string", enum: ["proposed", "declined", "handed_over", "paid", "not_paid"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    }),
    effect: "read", approval: "none", pluginId: null,
    async run(args, context) {
      return ok(await services(context).payments!.list({ status: typeof args.status === "string" ? args.status : undefined, limit: typeof args.limit === "number" ? args.limit : undefined }));
    },
  });

  const shopifyCart = paymentTool({
    name: "core_payments_shopify_cart",
    description: "For a Shopify store's product page, read the store's own product data to pick the exact variant, confirm it is in stock and its price, and build a cart link the owner can open to pay. Use before core_payments_propose when the store is on Shopify.",
    parameters: objectSchema({
      productUrl: { type: "string", description: "The https product page URL containing /products/." },
      options: { type: "object", additionalProperties: { type: "string" }, description: "Chosen option values by option name, e.g. {\"Size\": \"UK 9\"}." },
      quantity: { type: "integer", minimum: 1, maximum: 99 },
    }, ["productUrl"]),
    effect: "read", approval: "none", pluginId: null,
    async run(args, context) {
      const payments = services(context).payments!;
      if (!payments.shopifyCart) throw new Error("Shopify cart links are unavailable.");
      return ok(await payments.shopifyCart({ productUrl: args.productUrl, options: args.options, quantity: args.quantity }));
    },
  });

  const networkCheck = paymentTool({
    name: "core_payments_network_check",
    description: "For an offering found with core_people_search on another ME3 site, read the live price and available times straight from the seller's agent checkout. Use before core_payments_propose_network.",
    parameters: objectSchema({
      profileId: { type: "string", minLength: 1, description: "Stable profileId from core_people_search." },
      offeringId: { type: "string", minLength: 1, description: "Offering id from that search result, such as service:coaching." },
      from: { type: "string", description: "Optional start: a date (YYYY-MM-DD, seller-local) or an RFC 3339 time." },
      to: { type: "string", description: "Optional end date or time; at most 31 days after from." },
    }, ["profileId", "offeringId"]),
    effect: "read", approval: "none", pluginId: null,
    async run(args, context) {
      const payments = services(context).payments!;
      if (!payments.networkCheck) throw new Error("Network purchases are unavailable.");
      const { seller, fallbackUrl } = await rememberedSeller(context, requiredString(args.profileId, "Profile ID"), requiredString(args.offeringId, "Offering ID"));
      if (!seller) return ok({ status: "no_agent_checkout", fallbackUrl, next: "This seller does not take agent checkouts for this offering. Give the owner the seller's page link to book or buy there." });
      return ok(await payments.networkCheck(seller, { offeringId: args.offeringId, from: args.from, to: args.to }));
    },
  });

  const proposeNetwork = paymentTool({
    name: "core_payments_propose_network",
    description: "Propose buying an offering from another ME3 site for the owner to approve. ME3 reads the live price and time from the seller; after approval it asks the seller to hold it and gives the owner the seller's checkout to pay. Shares the owner's name and email with the seller. When other good options exist, mention them too.",
    parameters: objectSchema({
      profileId: { type: "string", minLength: 1, description: "Stable profileId from core_people_search." },
      offeringId: { type: "string", minLength: 1, description: "Offering id checked with core_payments_network_check." },
      slotStart: { type: "string", description: "Exact slot start from core_payments_network_check, for bookings and class sessions." },
      quantity: { type: "integer", minimum: 1, maximum: 100, description: "Number of places, for classes and events. Defaults to 1." },
      purpose: { type: "string", minLength: 1, maxLength: 500, description: "Why the owner is buying this, in their words." },
    }, ["profileId", "offeringId", "purpose"]),
    effect: "external", approval: "required", pluginId: null,
    async run(args, context) {
      const payments = services(context).payments!;
      if (!payments.proposeNetwork || !payments.handOverNetwork) throw new Error("Network purchases are unavailable.");
      const profileId = requiredString(args.profileId, "Profile ID"), offeringId = requiredString(args.offeringId, "Offering ID");
      // A resumed approval reuses the saved proposal, so it does not need the search again.
      const seller = context.approved ? null : (await rememberedSeller(context, profileId, offeringId)).seller;
      if (!context.approved && !seller) throw new Error("This seller does not take agent checkouts for this offering. Give the owner the seller's page link instead.");
      const proposal = await payments.proposeNetwork({ seller, offeringId, slotStart: args.slotStart, quantity: args.quantity, purpose: args.purpose }, { threadId: context.threadId, turnId: context.turnId, idempotencyKey: context.idempotencyKey });
      const network = proposal.network as { seller: { name: string }; slot: unknown; offering: unknown; sharesWith: { name: string; email: string } } | null;
      if (!network) throw new Error("This proposal is not a network purchase.");
      if (!context.approved) {
        const limits = await payments.limits(proposal.currency);
        return { status: "needs_approval", approval: {
          title: "Approve payment", summary: `${proposal.amount} ${proposal.currency} to ${proposal.merchant.name}`,
          kind: "payment", requiresFreshAuthentication: true, proposalId: proposal.id, proposalHash: proposal.proposalHash,
          merchant: proposal.merchant, purpose: proposal.purpose, items: proposal.items, amount: proposal.amount, currency: proposal.currency,
          amountMinor: proposal.amountMinor, method: "in_network", checkoutUrl: null, checkoutDomainDiffers: false, refundPolicy: proposal.refundPolicy, limits,
          network: { seller: network.seller, offering: network.offering, slot: network.slot, sharesWith: network.sharesWith, holdMinutes: 15 },
          sharesNotice: `Shares your name and email with ${network.seller.name}.`,
          howItWorks: NETWORK_HOW_IT_WORKS,
        } };
      }
      const approved = context.approvalData;
      if (approved?.proposalId !== proposal.id || approved?.proposalHash !== proposal.proposalHash) throw new Error("This approval does not match the reviewed payment proposal.");
      return ok(await payments.handOverNetwork(proposal.id, proposal.proposalHash));
    },
  });

  const networkStatus = paymentTool({
    name: "core_payments_network_status",
    description: "Check a network purchase with the seller now: whether the owner has paid, the receipt, or whether the hold expired. ME3 also checks automatically.",
    parameters: objectSchema({ paymentId: { type: "string", minLength: 1, description: "Stable payment ID from core_payments_list or the approval." } }, ["paymentId"]),
    effect: "write", approval: "none", pluginId: null,
    async run(args, context) {
      const payments = services(context).payments!;
      if (!payments.refreshNetwork) throw new Error("Network purchases are unavailable.");
      const payment = await payments.refreshNetwork(requiredString(args.paymentId, "Payment ID"));
      const receipt = payment.receipt as { mismatch?: boolean } | null;
      const network = payment.network as { checkoutStatus?: string } | null;
      return ok({ payment, next: receipt?.mismatch ? "Tell the owner the seller recorded a different amount from what they approved." : network?.checkoutStatus === "expired" ? "Tell the owner the hold expired and nothing was bought. Do not start a new checkout unless they ask." : "Tell the owner where the purchase stands." });
    },
  });

  return [propose, recordReceipt, list, shopifyCart, networkCheck, proposeNetwork, networkStatus];
}
