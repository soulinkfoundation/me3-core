import type { AgentTool, AgentToolContext, AgentToolResult } from "../types";
import { objectSchema, ok, requiredString, services } from "./common";

const MAX_EMAIL_READ_AGE_MS = 24 * 60 * 60 * 1000;
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

  return [propose, recordReceipt, list];
}
