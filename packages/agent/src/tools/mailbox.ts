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
      return ok({ ...result, ...await rememberTargets(context, "mailbox message", result.messages) });
    }),
    domainTool("core.mailbox.read", async (args, context) => {
      const service = services(context).mailbox;
      if (!service?.read) throw new Error("Mailbox read is unavailable.");
      const result = resultOrThrow(await service.read(requiredString(args.messageId, "Message ID")));
      await rememberTargets(context, "mailbox message", [result.message]); return ok(result);
    }),
    domainTool("core.mailbox.draft", async (args, context) => {
      const service = services(context).mailbox;
      if (!service?.createDraft) throw new Error("Mailbox drafting is unavailable.");
      const replyToMessageId = optionalString(args.replyToMessageId);
      if (replyToMessageId) {
        const source = await requireTarget<MailboxRecord>(context, "mailbox message", replyToMessageId);
        assertUnchanged(source, resultOrThrow(await service.read(replyToMessageId)).message, "Reply source");
      }
      const result = resultOrThrow(await service.createDraft({ to: requiredString(args.to, "Recipient"), subject: requiredString(args.subject, "Subject"), body: requiredString(args.body, "Body"), replyToMessageId }, context.idempotencyKey));
      await rememberTargets(context, "mailbox message", [result.draft]); return ok(result);
    }),
  ];
  tools.push({
    name: "core_mailbox_send", description: "Send one previously read or created mailbox draft using its stable ID. Requires durable owner approval of its exact recipient, subject, and body.",
    parameters: objectSchema({ draftId: idProperty("draft") }, ["draftId"]), effect: "external", approval: "required", pluginId: null,
    async execute(args, context) {
      try {
        if (Object.keys(args).some(key => key !== "draftId")) throw new Error("Only draftId is permitted; model confirmation cannot authorize sending.");
        if (context.signal.aborted) throw new Error("Turn cancelled.");
        const service = services(context).mailbox;
        if (!service?.sendDraft) throw new Error("Mailbox sending is unavailable.");
        const id = requiredString(args.draftId, "Draft ID");
        const expected = await requireTarget<MailboxRecord>(context, "mailbox message", id);
        const current = resultOrThrow(await service.read(id)).message;
        if (context.approved) {
          const immutable = (message: MailboxRecord) => Object.fromEntries(["to", "toAddress", "fromAddress", "subject", "bodyText", "textBody", "htmlBody", "inReplyTo", "referencesHeader", "messageIdHeader"].map(key => [key, message[key] ?? null]));
          assertUnchanged(immutable(expected), immutable(current), "Email draft");
        } else {
          assertUnchanged(expected, current, "Email draft");
          if (!["draft", "pending_approval", "failed"].includes(current.status || "")) throw new Error("This mailbox message is not a sendable draft.");
        }
        const pending = approval(context, "Send email", `To ${current.to || current.toAddress || "the reviewed recipient"}: ${current.subject || "(no subject)"}`, { target: expected, targetDomain: "mailbox message", recipient: current.to || current.toAddress, subject: current.subject, body: current.bodyText || current.textBody });
        if (pending) return pending;
        const result = await service.sendDraft(id, context.idempotencyKey, expected);
        if (result && typeof result === "object" && "error" in result) throw new Error(String(result.error));
        return ok(result);
      } catch (error) { return { status: "error", error: error instanceof Error ? error.message : String(error) }; }
    },
  });
  return tools;
}
