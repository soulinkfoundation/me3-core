import { toolIdempotencyKey, validateArguments } from "./schema";
import { compactAgentContext } from "./context";
import type { AgentCheckpoint, AgentModel, AgentTool, AgentToolCall, AgentToolResult, AgentTurnInput, AgentTurnResult } from "./types";

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
  state ??= {
    messages: input.messages, steps: 0, status: "running",
    trace: { model: model.id, steps: 0, toolCalls: [], startedAt: new Date().toISOString(), totalDurationMs: 0, timeToFirstTokenMs: null, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCostUsd: 0 } },
  };
  const checkpoint = state;
  const emit = async (event: Parameters<NonNullable<AgentTurnInput["onEvent"]>>[0]) => { await input.onEvent?.(event); };
  const save = () => input.store.save(checkpoint);
  const cancelled = async () => {
    if (!controller.signal.aborted && await input.store.cancellationRequested?.()) controller.abort("Owner cancelled");
    return controller.signal.aborted;
  };
  const finish = async (status: AgentCheckpoint["status"], text?: string) => {
    checkpoint.status = status;
    if (text) checkpoint.messages.push({role:"assistant",content:text});
    checkpoint.trace.totalDurationMs += performance.now() - started;
    await save();
    return result(checkpoint);
  };
  try {
    if (["complete", "cancelled", "failed"].includes(checkpoint.status)) return result(checkpoint);
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
          if (tool?.effect === "read") {
            while (end < checkpoint.pendingCalls.length && tools.find(tool => tool.name === checkpoint.pendingCalls![end].name)?.effect === "read") end++;
          }
          const calls = checkpoint.pendingCalls.slice(index, end);
          const outputs = await Promise.all(calls.map(item => execute(item, tools.find(tool => tool.name === item.name))));
          if (await cancelled()) return finish("cancelled", "The turn was cancelled before completion.");
          for (let i = 0; i < outputs.length; i++) {
            const output = outputs[i];
            if (output.status === "needs_approval") return finish("needs_approval");
            checkpoint.messages.push({role:"tool",toolCallId:calls[i].id,content:JSON.stringify(output)});
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
        await emit({event:"delta",data:{text}});
      } };
      let response;
      try { response = await model.step(stepInput); }
      catch (error) {
        // A failed request can still be billable, with no complete usage receipt.
        checkpoint.trace.usage.estimatedCostUsd = null;
        if (await cancelled()) return finish("cancelled", "The turn was cancelled before completion.");
        if (!input.backupModel || model === input.backupModel) throw error;
        model = input.backupModel;
        checkpoint.trace.model = model.id;
        if (emittedText) await emit({event:"status",data:{state:"retrying",replaceText:true}});
        response = await model.step(stepInput);
      }
      checkpoint.trace.model = model.id;
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
    if (needsApproval && !approved) {
      const prepared = await tool.prepareApproval?.(call.arguments, {...input.context,messages:checkpoint.messages,toolCallId:call.id,idempotencyKey:key,approved:false,signal:controller.signal});
      if (await cancelled()) return reject("Turn cancelled");
      if (prepared && prepared.status !== "needs_approval") return prepared;
      return pause(prepared?.approval ?? {title:tool.description,summary:JSON.stringify(call.arguments)});
    }
    const receipt = tool.effect === "read" ? null : await input.store.getReceipt(key);
    if (receipt && receipt.status !== "needs_approval") return receipt;
    if (tool.effect !== "read" && !await input.store.claimReceipt(key, call)) return reject("This action has an uncertain earlier outcome. Inspect the saved record before attempting another write.");
    const toolStarted = performance.now();
    await emit({event:"tool",data:{state:"running",name:tool.name,toolName:tool.name,callId:call.id}});
    let output: AgentToolResult;
    try {
      // No await separates this final cancellation check from effect admission.
      output = await cancelled() ? {status:"error",error:"Turn cancelled before the tool started"} : await tool.execute(call.arguments, {...input.context,messages:checkpoint.messages,toolCallId:call.id,idempotencyKey:key,approved,approvalData,signal:controller.signal});
    } catch (error) { output = {status:"error",error:error instanceof Error ? error.message : "Tool failed"}; }
    checkpoint.trace.toolCalls.push({name:tool.name,effect:tool.effect,status:output.status,durationMs:performance.now()-toolStarted});
    if (tool.effect !== "read") await input.store.finishReceipt(key, output);
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
  return {replyText,source:"agent",toolCalls:state.trace.toolCalls,usage:state.trace.usage,modelRequestCount:state.steps,trace:state.trace,status:state.status,...(state.approvalId?{approvalId:state.approvalId}:{})};
}
