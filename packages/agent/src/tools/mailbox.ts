import type { AgentTool } from "../types";
import { domainTool, idProperty, objectSchema, ok, optionalString, requiredString, resultOrThrow, services } from "./common";
import { approval, assertUnchanged, rememberTargets, requireTarget } from "./targets";
import type { MailboxRecord } from "./services";

export function mailboxTools(): AgentTool[] {
  const tools = [
    domainTool("core.mailbox.search", async (args, context) => {
      const service = services(context).mailbox;
      if (!service?.search) throw new Error("Mailbox search is unavailable.");
      const result = await service.search(args);
      return ok({ ...result, ...await rememberTargets(context, "mailbox message", result.messages, message => message.subject) });
    }),
    domainTool("core.mailbox.read", async (args, context) => {
      const service = services(context).mailbox;
      if (!service?.read) throw new Error("Mailbox read is unavailable.");
      const result = resultOrThrow(await service.read(requiredString(args.messageId, "Message ID")));
      await rememberTargets(context, "mailbox message", [result.message], message => message.subject); return ok(result);
    }),
    domainTool("core.mailbox.draft", async (args, context) => {
      const service = services(context).mailbox;
      if (!service?.createDraft) throw new Error("Mailbox drafting is unavailable.");
      const replyToMessageId = optionalString(args.replyToMessageId);
      if (replyToMessageId) {
        const source = await requireTarget<MailboxRecord>(context, "mailbox message", replyToMessageId);
        assertUnchanged(source, resultOrThrow(await service.read(replyToMessageId)).message, "Reply source");
      }
      context.signal.throwIfAborted();
      const to = optionalString(args.to)?.trim();
      if (!to) {
        // No address known: nothing is saved. Chat shows the draft as a card that asks the owner for it.
        return ok({ saved: false, draft: { id: null, toAddress: "", recipientName: optionalString(args.recipientName) ?? null, contactId: optionalString(args.contactId) ?? null,
          subject: requiredString(args.subject, "Subject"), body: requiredString(args.body, "Body"), replyToMessageId: replyToMessageId ?? null },
          next: "Tell the owner the draft card needs their recipient's email address; nothing was saved or sent." });
      }
      const result = resultOrThrow(await service.createDraft({ to, subject: requiredString(args.subject, "Subject"), body: requiredString(args.body, "Body"), replyToMessageId }, context.idempotencyKey));
      await rememberTargets(context, "mailbox message", [result.draft], message => message.subject); return ok(result);
    }),
  ];
  const sendTool: AgentTool = {
    name: "core_mailbox_send", description: "Send one previously read or created mailbox draft using its stable ID. Requires durable owner approval of its exact recipient, subject, and body.",
    parameters: objectSchema({ draftId: idProperty("draft") }, ["draftId"]), effect: "external", approval: "required", pluginId: null,
    target: { domain: "mailbox message", idParameter: "draftId", actionLabel: "Send email draft" },
    async execute(args, context) {
      try {
        context = { ...context, declaredTarget: sendTool.target, toolCall: { id: context.toolCallId, name: sendTool.name, arguments: args } };
        if (Object.keys(args).some(key => key !== "draftId")) throw new Error("Only draftId is permitted; model confirmation cannot authorize sending.");
        if (context.signal.aborted) throw new Error("Turn cancelled.");
        const service = services(context).mailbox;
        if (!service?.sendDraft) throw new Error("Mailbox sending is unavailable.");
        const id = requiredString(args.draftId, "Draft ID");
        const expected = await requireTarget<MailboxRecord>(context, "mailbox message", id);
        const current = resultOrThrow(await service.read(id)).message;
        if (current.deliveryIdentity === null) throw new Error("Configure an email sender before reviewing this draft for sending.");
        if (context.approved) {
          const immutable = (message: MailboxRecord) => Object.fromEntries(["to", "toAddress", "fromAddress", "subject", "bodyText", "textBody", "htmlBody", "inReplyTo", "referencesHeader", "messageIdHeader"].map(key => [key, message[key] ?? null]));
          assertUnchanged(immutable(expected), immutable(current), "Email draft");
        } else {
          assertUnchanged(expected, current, "Email draft");
          if (!["draft", "pending_approval", "failed"].includes(current.status || "")) throw new Error("This mailbox message is not a sendable draft.");
        }
        const pending = approval(context, "Send email", `To ${current.to || current.toAddress || "the reviewed recipient"}: ${current.subject || "(no subject)"}`, { target: expected, targetDomain: "mailbox message", recipient: current.to || current.toAddress, subject: current.subject, body: current.bodyText || current.textBody });
        if (pending) return pending;
        context.signal.throwIfAborted();
        const result = await service.sendDraft(id, context.idempotencyKey, expected);
        if (result && typeof result === "object" && "error" in result) throw new Error(String(result.error));
        return ok(result);
      } catch (error) { return { status: "error", error: error instanceof Error ? error.message : String(error), ...(error && typeof error === "object" && "data" in error ? { data: error.data } : {}) }; }
    },
  };
  tools.push(sendTool);
  return tools;
}
