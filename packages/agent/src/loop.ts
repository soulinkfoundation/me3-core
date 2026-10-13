import type {AgentTargetIntentReceipt} from "./types";
import { preflightTargetIntent, savedTargetIntentProgress, TargetIntentOrderMismatch } from "./target-intent";
import { canonicalJson, toolIdempotencyKey, validateArguments } from "./schema";
import { compactAgentContext } from "./context";
import { validateTargetSelection } from "./presentations";
import { startFastPathShadow } from "./fast-path";
import type { AgentCheckpoint, AgentModel, AgentTargetPresentationCard, AgentTool, AgentToolCall, AgentToolResult, AgentTurnInput, AgentTurnResult } from "./types";

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const started = performance.now();
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort("Agent time budget exceeded"), input.timeBudgetMs ?? 300_000);
  const tools = input.tools.filter(tool => !tool.pluginId || input.context.enabledPluginIds.has(tool.pluginId));
  let model: AgentModel = input.model;
  let state = await input.store.load();
  const freshTurn = !state;
  state ??= {
    messages: input.messages, steps: 0, status: "running",
    trace: { model: model.id, steps: 0, toolCalls: [], startedAt: new Date().toISOString(), totalDurationMs: 0, timeToFirstTokenMs: null, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 } },
  };
  const checkpoint = state;
  const measureModel = async (selected: AgentModel, step: Parameters<AgentModel["step"]>[0]) => {
    const began = performance.now();
    try {
      const response = await selected.step(step);
      (checkpoint.trace.modelSteps ??= []).push({ step: checkpoint.steps + 1, model: selected.id, status: "complete", durationMs: performance.now() - began, ...(response.usage ? { usage: response.usage } : {}), ...(response.billingUsageId ? { billingUsageId: response.billingUsageId } : {}), toolCalls: response.toolCalls.map(({ name, arguments: args }) => ({ name, arguments: structuredClone(args) })) });
      return response;
    } catch (error) {
      (checkpoint.trace.modelSteps ??= []).push({ step: checkpoint.steps + 1, model: selected.id, status: "error", durationMs: performance.now() - began, toolCalls: [] });
      throw error;
    }
  };
  let shadow: ReturnType<typeof startFastPathShadow>;
  const emit = async (event: Parameters<NonNullable<AgentTurnInput["onEvent"]>>[0]) => { await input.onEvent?.(event); };
  const save = () => input.store.save(checkpoint);
  const cancelled = async () => {
    if (!controller.signal.aborted && await input.store.cancellationRequested?.()) controller.abort("Owner cancelled");
    return controller.signal.aborted;
  };
  const finish = async (status: AgentCheckpoint["status"], text?: string) => {
    if (shadow && !checkpoint.trace.fastPath) checkpoint.trace.fastPath = shadow.snapshot([]);
    checkpoint.status = status;
    if (text) checkpoint.messages.push({role:"assistant",content:text});
    checkpoint.trace.totalDurationMs += performance.now() - started;
    await save();
    const completed = result(checkpoint);
    if (text || status === "needs_approval") await emit({event:"delta",data:{text:completed.replyText,source:"runtime"}});
    return completed;
  };
  const unfinishedPlan = async () => {
    if (!input.context.verifyTargetIntent) return;
    const progress = await savedTargetIntentProgress({...input.context,messages:checkpoint.messages,toolCallId:"",idempotencyKey:"",signal:controller.signal});
    if (checkpoint.status !== "complete" && await cancelled()) {
      await emit({event:"status",data:{state:"running",replaceText:true}});
      return finish("cancelled", "The turn was cancelled before completion.");
    }
    if (!progress || progress.completed === progress.total) return;
    const text = `Completed ${progress.completed} of ${progress.total} requested actions. The remaining work is unfinished.`;
    const declinedText = `The next action was declined. ${text}`;
    if (progress.declined && checkpoint.status === "complete" && result(checkpoint).replyText === declinedText) return;
    await emit({event:"status",data:{state:"running",replaceText:true}});
    if (progress.declined) return finish("complete", declinedText);
    return finish("failed", text);
  };
  try {
    if (checkpoint.status === "complete") return await unfinishedPlan() ?? result(checkpoint);
    if (["cancelled", "failed"].includes(checkpoint.status)) return result(checkpoint);
    if (freshTurn && input.context.targetSelection) {
      const chosen = await validateTargetSelection({ ...input.context, messages: checkpoint.messages, toolCallId: "", idempotencyKey: "", signal: controller.signal }, input.context.targetSelection, tools);
      if (chosen.presentation.status !== "selected") throw new Error("The choice was not authenticated and persisted.");
      checkpoint.messages.push({ role: "assistant", content: "", toolCalls: [chosen.call] });
      checkpoint.pendingCalls = [chosen.call];
      checkpoint.nextCallIndex = 0;
      await save();
    }
    await emit({event:"status",data:{state:"running",runtime:"agent",replaceText:checkpoint.steps>0}});
    while (true) {
      if (await cancelled()) return finish("cancelled", "The turn was cancelled before completion.");
      if (checkpoint.pendingCalls?.length) {
        while ((checkpoint.nextCallIndex ?? 0) < checkpoint.pendingCalls.length) {
          const index = checkpoint.nextCallIndex ?? 0;
          const call = checkpoint.pendingCalls[index];
          const tool = tools.find(tool => tool.name === call.name);
          // A contiguous read group can run concurrently; effects retain model order.
          let end = index + 1;
          if (tool?.effect === "read" && !tool.endsTurn) {
            while (end < checkpoint.pendingCalls.length) {
              const next = tools.find(tool => tool.name === checkpoint.pendingCalls![end].name);
              if (next?.effect !== "read" || next.endsTurn) break;
              end++;
            }
          }
          const calls = checkpoint.pendingCalls.slice(index, end);
          const outputs = await Promise.all(calls.map(item => execute(item, tools.find(tool => tool.name === item.name))));
          if (await cancelled()) return finish("cancelled", "The turn was cancelled before completion.");
          for (let i = 0; i < outputs.length; i++) {
            const output = outputs[i];
            if (output.status === "needs_approval") return finish("needs_approval");
            checkpoint.messages.push({role:"tool",toolCallId:calls[i].id,content:JSON.stringify(output)});
            if (output.status === "needs_selection" && tools.find(tool => tool.name === calls[i].name)?.endsTurn) {
              checkpoint.targetPresentation = (output.data as { targetPresentation: AgentTargetPresentationCard }).targetPresentation;
              checkpoint.pendingCalls = undefined;
              checkpoint.nextCallIndex = undefined;
              checkpoint.approvalId = undefined;
              return finish("complete", "Choose a record to continue with the proposed action.");
            }
          }
          checkpoint.nextCallIndex = end;
          checkpoint.approvalId = undefined;
          await save();
          if (await cancelled()) return finish("cancelled", "The turn was cancelled before completion.");
        }
        checkpoint.pendingCalls = undefined;
        checkpoint.nextCallIndex = undefined;
        checkpoint.status = "running";
        await save();
      }
      if (checkpoint.steps >= (input.maxSteps ?? 30)) return finish("failed", "I reached the turn's step limit. Completed tool results are saved; the remaining work is unfinished.");
      let emittedText = false;
      const stepInput = { messages: compactAgentContext(checkpoint.messages, input.contextWindow), tools, signal: controller.signal, onDelta: async (text: string) => {
        if (!text) return;
        emittedText = true;
        checkpoint.trace.timeToFirstTokenMs ??= performance.now() - started;
        await emit({event:"delta",data:{text,source:"model"}});
      } };
      let response;
      if (freshTurn && !input.context.targetSelection && checkpoint.steps === 0) shadow = startFastPathShadow(input.fastPath, { messageText: input.context.messageText, recentMessages: checkpoint.messages, tools, ownerTimezone: input.context.ownerTimezone, now: new Date(), signal: controller.signal });
      try { response = await measureModel(model, stepInput); }
      catch (error) {
        // A failed request can still be billable, with no complete usage receipt.
        checkpoint.trace.usage.estimatedCostUsd = null;
        if (await cancelled()) return finish("cancelled", "The turn was cancelled before completion.");
        if (!input.backupModel || model === input.backupModel) throw error;
        model = input.backupModel;
        checkpoint.trace.model = model.id;
        if (emittedText) await emit({event:"status",data:{state:"retrying",replaceText:true}});
        response = await measureModel(model, stepInput);
      }
      checkpoint.trace.model = model.id;
      if (shadow && checkpoint.steps === 0) checkpoint.trace.fastPath = shadow.snapshot(response.toolCalls);
      checkpoint.steps++;
      checkpoint.trace.steps = checkpoint.steps;
      if (response.usage) {
        checkpoint.trace.usage.inputTokens += response.usage.inputTokens;
        checkpoint.trace.usage.outputTokens += response.usage.outputTokens;
        checkpoint.trace.usage.cachedInputTokens += response.usage.cachedInputTokens;
        checkpoint.trace.usage.cacheWriteInputTokens = (checkpoint.trace.usage.cacheWriteInputTokens ?? 0) + (response.usage.cacheWriteInputTokens ?? 0);
        checkpoint.trace.usage.estimatedCostUsd = response.usage.estimatedCostUsd === null || checkpoint.trace.usage.estimatedCostUsd === null ? null : checkpoint.trace.usage.estimatedCostUsd + response.usage.estimatedCostUsd;
      } else checkpoint.trace.usage.estimatedCostUsd = null;
      if (await cancelled()) return finish("cancelled", "The turn was cancelled before completion.");
      if (!response.toolCalls.length && response.text.trim()) {
        try { const unfinished = await unfinishedPlan(); if (unfinished) return unfinished; }
        catch (error) { await emit({event:"status",data:{state:"running",replaceText:true}}); throw error; }
      }
      checkpoint.messages.push({role:"assistant",content:response.text, ...(response.toolCalls.length ? {toolCalls:response.toolCalls} : {})});
      checkpoint.pendingCalls = response.toolCalls;
      checkpoint.nextCallIndex = 0;
      await save();
      await emit({event:"step",data:{step:checkpoint.steps,model:model.id}});
      if (!response.toolCalls.length) {
        if (!response.text.trim()) return finish("failed", "The model returned no answer. No completion is claimed.");
        return finish("complete");
      }
    }
  } catch (error) {
    if (await cancelled()) return finish("cancelled", "The turn was cancelled before completion.");
    return finish("failed", `I couldn't complete this turn: ${error instanceof Error ? error.message : "agent failure"}`);
  } finally {
    shadow?.close();
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }

  async function execute(call: AgentToolCall, tool?: AgentTool): Promise<AgentToolResult> {
    if (await cancelled()) return {status:"error",error:"Turn cancelled"};
    if (!tool) return {status:"error",error:`Tool ${call.name} is unavailable`};
    const reject = (error: string): AgentToolResult => {
      checkpoint.trace.toolCalls.push({name:tool.name,effect:tool.effect,status:"error",durationMs:0});
      return {status:"error",error};
    };
    const invalid = validateArguments(tool.parameters, call.arguments);
    if (invalid) return reject(invalid);
    if (input.context.targetSelection && tool.effect !== "read") {
      try {
        const chosen = await validateTargetSelection({ ...input.context, messages: checkpoint.messages, toolCallId: call.id, idempotencyKey: "", signal: controller.signal }, input.context.targetSelection, tools);
        if (chosen.presentation.status !== "selected" || canonicalJson({ name: call.name, arguments: call.arguments }) !== canonicalJson({ name: chosen.call.name, arguments: chosen.call.arguments })) return reject("Only the exact authenticated selected action can execute in this turn.");
      } catch (error) { return reject(error instanceof Error ? error.message : "Invalid target choice"); }
    }
    const key = await toolIdempotencyKey(input.context.ownerId, input.context.requestId, call.name, tool.idempotencyArguments?.(call.arguments) ?? call.arguments);
    let approved = false;
    let approvalData: Record<string, unknown> | undefined;
    if (checkpoint.approvalId) {
      const decision = await input.store.approvalDecision(checkpoint.approvalId);
      if (decision === "pending") return {status:"needs_approval",approval:{id:checkpoint.approvalId,title:tool.description,summary:"Waiting for owner approval"}};
      if (decision === "declined") return reject("The owner declined this action. Do not execute or claim completion.");
      approved = true;
      approvalData = await input.store.approvalData?.(checkpoint.approvalId);
    }
    const needsApproval = tool.approval === "required" || tool.effect === "external" || tool.effect === "destructive";
    const receipt = tool.effect === "read" ? null : await input.store.getReceipt(key);
    if (receipt && receipt.status !== "needs_approval") return receipt;
    if (tool.effect !== "read" && !await input.store.claimReceipt(key, call)) return reject("This action has an uncertain earlier outcome. Inspect the saved record before attempting another write.");
    const toolStarted = performance.now();
    await emit({event:"tool",data:{state:"running",name:tool.name,toolName:tool.name,callId:call.id}});
    const context = {...input.context,messages:checkpoint.messages,toolCall:call,toolCallId:call.id,idempotencyKey:key,effectReceiptClaimed:tool.effect!=="read",approved,approvalData,signal:controller.signal,
      intentToolContracts: tools.filter(value=>value.target).map(({name,description,parameters,effect,approval,target})=>({name,description,parameters,effect,approval,target:{domain:target!.domain,idParameter:target!.idParameter}})),
      onTargetIntentReceipt: async (record: AgentTargetIntentReceipt) => {
        if (!record.inference) return;
        const requests = (checkpoint.trace.targetIntentRequests ??= []);
        if (requests.some(value=>value.receiptId===record.receiptId)) return;
        requests.push({receiptId:record.receiptId,modelId:record.inference.modelId,...(record.inference.usageId?{usageId:record.inference.usageId}:{}),uncertain:!!record.uncertain});
        const usage=record.inference.usage;
        if (usage) {
          checkpoint.trace.usage.inputTokens+=usage.inputTokens;
          checkpoint.trace.usage.outputTokens+=usage.outputTokens;
          checkpoint.trace.usage.cachedInputTokens+=usage.cachedInputTokens;
          checkpoint.trace.usage.cacheWriteInputTokens=(checkpoint.trace.usage.cacheWriteInputTokens??0)+(usage.cacheWriteInputTokens??0);
          checkpoint.trace.usage.estimatedCostUsd=usage.estimatedCostUsd===null||checkpoint.trace.usage.estimatedCostUsd===null?null:checkpoint.trace.usage.estimatedCostUsd+usage.estimatedCostUsd;
        } else checkpoint.trace.usage.estimatedCostUsd=null;
        await input.context.onTargetIntentReceipt?.(record);
        await save();
      },
    };
    let output: AgentToolResult;
    let notAdmitted = false;
    try {
      const hasTarget = tool.target && (Object.hasOwn(call.arguments, tool.target.idParameter) || (tool.parameters.required as string[] | undefined)?.includes(tool.target.idParameter));
      if (hasTarget && tool.target && !approved && !input.context.targetSelection) {
        try { await preflightTargetIntent(context,tool.target.domain,String(call.arguments[tool.target.idParameter]),call); }
        catch (error) {
          // Only this preflight can prove that a later ordered effect never started.
          notAdmitted = error instanceof TargetIntentOrderMismatch;
          throw error;
        }
      }
      if (await cancelled()) output={status:"error",error:"Turn cancelled before the tool started"};
      else if (needsApproval && !approved) {
        const prepared=await tool.prepareApproval?.(call.arguments,context);
        output=prepared??{status:"needs_approval",approval:{title:tool.description,summary:JSON.stringify(call.arguments)}};
      } else output=await tool.execute(call.arguments,context);
    } catch (error) { output={status:"error",error:error instanceof Error?error.message:"Tool failed",...(error&&typeof error==="object"&&"data" in error?{data:error.data}:{})}; }
    checkpoint.trace.toolCalls.push({name:tool.name,effect:tool.effect,status:output.status,durationMs:performance.now()-toolStarted});
    if (tool.effect !== "read") await input.store.finishReceipt(key, output, { notAdmitted });
    await emit({event:"tool",data:{state:"complete",name:tool.name,toolName:tool.name,callId:call.id,result:output}});
    if (output.status === "needs_approval") return pause(output.approval ?? {title:tool.description,summary:"Approval required"});
    return output;

    async function pause(card: NonNullable<AgentToolResult["approval"]>): Promise<AgentToolResult> {
      if (await cancelled()) return reject("Turn cancelled");
      checkpoint.approvalId = await input.store.requestApproval(key, call, card);
      if (await cancelled()) return reject("Turn cancelled");
      checkpoint.status = "needs_approval";
      await save();
      await emit({event:"approval_required",data:{...card,id:checkpoint.approvalId,toolName:call.name,arguments:call.arguments}});
      return {status:"needs_approval",approval:{...card,id:checkpoint.approvalId}};
    }
  }
}

function result(state: AgentCheckpoint): AgentTurnResult {
  const replyText = state.status === "needs_approval" ? "This action needs your approval before I can continue." : [...state.messages].reverse().find(message => message.role === "assistant" && !message.toolCalls?.length)?.content ?? "";
  return {replyText,source:"agent",toolCalls:state.trace.toolCalls,usage:state.trace.usage,modelRequestCount:state.steps+(state.trace.targetIntentRequests?.length??0),trace:state.trace,status:state.status,...(state.approvalId?{approvalId:state.approvalId}:{}),...(state.targetPresentation?{targetPresentation:state.targetPresentation}:{})};
}
