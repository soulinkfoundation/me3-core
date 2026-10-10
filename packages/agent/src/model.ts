import type { AgentMessage, AgentModel, AgentModelResponse, AgentTool, AgentToolCall, AgentUsage } from "./types";

export interface CloudflareModelOptions {
  ai: { run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };
  model: string;
  gatewayId?: string | null;
  metadata?: Record<string, string | number | boolean>;
  maxOutputTokens?: number;
  pricing?: { input: number; output: number; cachedInput?: number; cacheWriteInput?: number };
  recordUsage?(usage: AgentUsage): Promise<void> | void;
}

// Catalog prices per million tokens, excluding infrastructure and Gateway fees.
const PRICING: Record<string, {input:number;output:number;cachedInput?:number;cacheWriteInput?:number}> = {
  "openai/gpt-6-astra": {input:10,output:50,cachedInput:1},
  "openai/gpt-6.1-sol": {input:2,output:10,cachedInput:0.1,cacheWriteInput:2.5},
  "openai/gpt-5.5": {input:5,output:30,cachedInput:0.5},
  "anthropic/claude-opus-5.5": {input:4,output:20,cachedInput:0.2,cacheWriteInput:5},
  "anthropic/claude-sonnet-5.5": {input:2,output:10,cachedInput:0.1,cacheWriteInput:2.5},
};

export function createCloudflareModel(options: CloudflareModelOptions): AgentModel {
  const model = options.model.replace(/^@cf\/(?=(?:openai|anthropic)\/)/, "");
  const anthropic = model.startsWith("anthropic/");
  const responses = model.startsWith("openai/gpt-6");
  if (/^(openai|anthropic)\//.test(model) && !options.gatewayId) throw new Error("External models require the installation's AI Gateway");
  return {
    id: model,
    async step({messages,tools,signal,onDelta}): Promise<AgentModelResponse> {
      signal.throwIfAborted();
      const request = anthropic ? anthropicRequest(messages, tools, options.maxOutputTokens ?? 4096) : responses ? responsesRequest(messages,tools,options.maxOutputTokens??4096) : openAiRequest(messages, tools, options.maxOutputTokens ?? 4096, model);
      const result = await options.ai.run(model, {...request,stream:true}, options.gatewayId ? {gateway:{id:options.gatewayId,metadata:options.metadata ?? {},requestTimeoutMs:60_000,retries:{maxAttempts:1}}} : undefined);
      signal.throwIfAborted();
      const response = isStream(result) ? await consumeStream(result, anthropic, onDelta, signal) : parseResponse(result, anthropic);
      if (!isStream(result) && response.text) await onDelta(response.text);
      if (response.usage) {
        response.usage.estimatedCostUsd = estimateCost(model, response.usage, options.pricing);
        await options.recordUsage?.(response.usage);
      }
      return response;
    },
  };
}

function responsesRequest(messages:readonly AgentMessage[],tools:readonly AgentTool[],maxTokens:number):Record<string,unknown> {
  const input:unknown[]=[];
  for(const message of messages.filter(message=>message.role!=="system")) {
    if(message.role==="tool") {input.push({type:"function_call_output",call_id:message.toolCallId,output:message.content});continue;}
    if(message.content||message.images?.length) input.push({role:message.role,content:[...(message.content?[{type:message.role==="assistant"?"output_text":"input_text",text:message.content}]:[]),...(message.images?.map(image=>({type:"input_image",image_url:image.url}))??[])]});
    for(const call of message.toolCalls??[])input.push({type:"function_call",call_id:call.id,name:call.name,arguments:JSON.stringify(call.arguments)});
  }
  return {input,instructions:messages.filter(message=>message.role==="system").map(message=>message.content).join("\n\n"),tools:tools.map(tool=>({type:"function",name:tool.name,description:tool.description,parameters:tool.parameters,strict:false})),max_output_tokens:maxTokens,reasoning:{effort:"low"},store:false};
}

function openAiRequest(messages: readonly AgentMessage[], tools: readonly AgentTool[], maxTokens: number, model: string): Record<string, unknown> {
  const reasoning = /^openai\/(?:gpt-[5-9]|o\d)/.test(model);
  return {
    messages: messages.map(message => ({role:message.role,content:message.images?.length ? [{type:"text",text:message.content},...message.images.map(image=>({type:"image_url",image_url:{url:image.url}}))] : message.content,
      ...(message.toolCallId?{tool_call_id:message.toolCallId}:{}),
      ...(message.toolCalls?.length?{tool_calls:message.toolCalls.map(call=>({id:call.id,type:"function",function:{name:call.name,arguments:JSON.stringify(call.arguments)}}))}:{}),
    })),
    ...(tools.length?{tools:tools.map(tool=>({type:"function",function:{name:tool.name,description:tool.description,parameters:tool.parameters,strict:false}}))}:{}),
    ...(reasoning?{max_completion_tokens:maxTokens,reasoning_effort:"low"}:{max_tokens:maxTokens}),
    stream_options: {include_usage:true},
  };
}

function anthropicRequest(messages: readonly AgentMessage[], tools: readonly AgentTool[], maxTokens: number): Record<string, unknown> {
  const history: Array<{role:"user"|"assistant";content:unknown[]}> = [];
  for (const message of messages.filter(message=>message.role!=="system")) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content: unknown[] = message.role === "tool" ? [{type:"tool_result",tool_use_id:message.toolCallId,content:message.content}] : [
      ...(message.content ? [{type:"text",text:message.content}] : []),
      ...(message.images?.map(image => {
        const match = /^data:([^;]+);base64,(.*)$/.exec(image.url);
        return {type:"image",source:match?{type:"base64",media_type:match[1],data:match[2]}:{type:"url",url:image.url}};
      }) ?? []),
      ...(message.toolCalls?.map(call=>({type:"tool_use",id:call.id,name:call.name,input:call.arguments})) ?? []),
    ];
    if (!content.length) continue;
    if (history.at(-1)?.role === role) history.at(-1)!.content.push(...content);
    else history.push({role,content});
  }
  return {
    system: [{type:"text",text:messages.filter(message=>message.role==="system").map(message=>message.content).join("\n\n"),cache_control:{type:"ephemeral"}}],
    messages:history,
    ...(tools.length?{tools:tools.map((tool,index)=>({name:tool.name,description:tool.description,input_schema:tool.parameters,...(index===tools.length-1?{cache_control:{type:"ephemeral"}}:{})}))}:{}),
    max_tokens:maxTokens,
  };
}

async function consumeStream(stream: ReadableStream<Uint8Array>, anthropic: boolean, onDelta: (text: string)=>Promise<void>, signal: AbortSignal): Promise<AgentModelResponse> {
  const reader=stream.getReader();const decoder=new TextDecoder();let buffer="";let text="";
  let completed=false,nativeProtocol=anthropic;
  let usage: AgentUsage | undefined;
  const calls=new Map<number,{id:string;name:string;json:string;input?:Record<string,unknown>}>();
  const abort=()=>void reader.cancel("cancelled");signal.addEventListener("abort",abort,{once:true});
  async function consume(frame:string) {
    const data=frame.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data==="[DONE]") {if(!nativeProtocol)completed=true;return;}
    const raw=record(JSON.parse(data));const event=record(raw.result ?? raw);
    if(event.error || event.type==="error" || event.type==="response.failed" || event.type==="response.incomplete") throw new Error(String(record(event.error).message ?? "Model stream failed or was truncated"));
    if(typeof event.type==="string" && event.type.startsWith("response.")) {
      nativeProtocol=true;
      const index=Number(event.output_index??0);const item=record(event.item);
      if(event.type==="response.output_text.delta") {const part=String(event.delta??"");text+=part;await onDelta(part);}
      if(event.type==="response.output_item.added" && item.type==="function_call")calls.set(index,{id:String(item.call_id),name:String(item.name),json:String(item.arguments??"")});
      if(event.type==="response.function_call_arguments.delta") {const call=calls.get(index);if(!call)throw new Error("Missing Responses tool block");call.json+=String(event.delta??"");}
      if(event.type==="response.function_call_arguments.done") {const call=calls.get(index);if(call&&typeof event.arguments==="string")call.json=event.arguments;}
      if(event.type==="response.output_item.done" && item.type==="function_call")calls.set(index,{id:String(item.call_id),name:String(item.name),json:String(item.arguments??calls.get(index)?.json??"")});
      if(event.type==="response.completed") {const response=record(event.response);if(response.status==="failed"||response.status==="incomplete")throw new Error("Responses request did not complete");completed=true;if(response.usage)usage=readUsage(response.usage,false,usage);}
    } else if(anthropic) {
      if(event.type==="message_stop")completed=true;
      if(event.type==="message_start") usage=readUsage(record(event.message).usage,true,usage);
      if(event.type==="message_delta") {
        usage=readUsage(event.usage,true,usage);
        if(record(event.delta).stop_reason==="max_tokens") throw new Error("Model response was truncated");
      }
      const index=Number(event.index ?? 0);const block=record(event.content_block);const delta=record(event.delta);
      if(event.type==="content_block_start" && block.type==="tool_use") calls.set(index,{id:String(block.id),name:String(block.name),json:"",input:record(block.input)});
      if(event.type==="content_block_delta" && delta.type==="text_delta") {const part=String(delta.text ?? "");text+=part;await onDelta(part);}
      if(event.type==="content_block_delta" && delta.type==="input_json_delta") {const call=calls.get(index);if(!call)throw new Error("Missing Anthropic tool block");call.json+=String(delta.partial_json ?? "");}
    } else {
      if(event.usage) usage=readUsage(event.usage,false,usage);
      if(typeof event.response==="string") {text+=event.response;await onDelta(event.response);}
      const choices=Array.isArray(event.choices)?event.choices:[];
      const choice=record(choices[0]);const delta=record(choice.delta);
      if(choice.finish_reason==="length") throw new Error("Model response was truncated");
      if(choice.finish_reason)completed=true;
      const part=typeof delta.content==="string"?delta.content:typeof delta.refusal==="string"?delta.refusal:"";
      if(part){text+=part;await onDelta(part);}
      for(const value of Array.isArray(delta.tool_calls)?delta.tool_calls:[]) {
        const valueRecord=record(value);const index=Number(valueRecord.index ?? 0);const fn=record(valueRecord.function);
        const call=calls.get(index)??{id:"",name:"",json:""};
        if(valueRecord.id)call.id=String(valueRecord.id);if(fn.name)call.name+=String(fn.name);if(fn.arguments)call.json+=String(fn.arguments);calls.set(index,call);
      }
    }
  }
  try {
    while(true) {
      signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;
      buffer+=decoder.decode(chunk.value,{stream:true});
      // Normalize after accumulation so CRLF split across chunks stays intact.
      let match=/\r?\n\r?\n/.exec(buffer);
      while(match){await consume(buffer.slice(0,match.index).replace(/\r\n/g,"\n"));buffer=buffer.slice(match.index+match[0].length);match=/\r?\n\r?\n/.exec(buffer);}
    }
    signal.throwIfAborted();buffer+=decoder.decode();if(buffer.trim())await consume(buffer.replace(/\r\n/g,"\n"));
    if(!completed)throw new Error("Model stream did not complete; no tool calls are accepted");
  } catch(error) {await reader.cancel().catch(()=>{});throw error;}
  finally {signal.removeEventListener("abort",abort);reader.releaseLock();}
  return {text,toolCalls:[...calls.entries()].sort(([a],[b])=>a-b).map(([,call])=>({id:call.id || crypto.randomUUID(),name:call.name,arguments:parseArguments(call.json || JSON.stringify(call.input ?? {}))})),...(usage?{usage}:{})};
}

function parseResponse(raw: unknown, anthropic: boolean): AgentModelResponse {
  let event=record(raw);if(event.success===false || event.error)throw new Error(String(record(event.error).message ?? "Cloudflare model failed"));
  event=record(event.result ?? event);
  if(event.object==="response" || Array.isArray(event.output)) {
    if(event.status==="incomplete"||event.status==="failed")throw new Error("Responses request did not complete");
    const output=Array.isArray(event.output)?event.output:[];
    return {text:typeof event.output_text==="string"?event.output_text:output.filter(item=>record(item).type==="message").flatMap(item=>Array.isArray(record(item).content)?record(item).content as unknown[]:[]).filter(item=>record(item).type==="output_text").map(item=>String(record(item).text??"")).join(""),toolCalls:output.filter(item=>record(item).type==="function_call").map(item=>{const call=record(item);return{id:String(call.call_id),name:String(call.name),arguments:parseArguments(String(call.arguments))};}),...(event.usage?{usage:readUsage(event.usage,false)}:{})};
  }
  const content=Array.isArray(event.content)?event.content:[];const choice=record(Array.isArray(event.choices)?event.choices[0]:null);const message=record(choice.message);
  if(choice.finish_reason==="length" || event.stop_reason==="max_tokens")throw new Error("Model response was truncated");
  const text=typeof event.response==="string"?event.response:typeof message.content==="string"?message.content:content.filter(item=>record(item).type==="text").map(item=>record(item).text ?? "").join("");
  const toolCalls: AgentToolCall[] = anthropic ? content.filter(item=>record(item).type==="tool_use").map(item=>{const block=record(item);return{id:String(block.id),name:String(block.name),arguments:record(block.input)};}) : (Array.isArray(message.tool_calls)?message.tool_calls:Array.isArray(event.tool_calls)?event.tool_calls:[]).map(item=>{const call=record(item);const fn=record(call.function ?? call);return{id:String(call.id ?? crypto.randomUUID()),name:String(fn.name),arguments:typeof fn.arguments==="string"?parseArguments(fn.arguments):record(fn.arguments)};});
  const usage=event.usage?readUsage(event.usage,anthropic):undefined;
  return {text,toolCalls,...(usage?{usage}:{})};
}

function readUsage(value:unknown,anthropic:boolean,previous?:AgentUsage):AgentUsage {
  const usage=record(value);
  const details=record(usage.prompt_tokens_details??usage.input_tokens_details);
  const cached=Number(anthropic?usage.cache_read_input_tokens ?? previous?.cachedInputTokens ?? 0:details.cached_tokens ?? 0);
  const cacheWrite=Number(anthropic?usage.cache_creation_input_tokens??previous?.cacheWriteInputTokens??0:details.cache_write_tokens??0);
  const input=anthropic && usage.input_tokens===undefined ? previous?.inputTokens ?? 0 : Number(anthropic?usage.input_tokens ?? 0:usage.prompt_tokens ?? usage.input_tokens ?? 0)+(anthropic?cached+Number(usage.cache_creation_input_tokens ?? 0):0);
  return {inputTokens:input,outputTokens:Number(usage.output_tokens ?? usage.completion_tokens ?? previous?.outputTokens ?? 0),cachedInputTokens:cached,cacheWriteInputTokens:cacheWrite,estimatedCostUsd:null};
}
function estimateCost(model:string,usage:AgentUsage,pricing?:CloudflareModelOptions["pricing"]):number|null {
  const price=pricing ?? PRICING[model];if(!price)return null;
  const cached=Math.min(usage.cachedInputTokens,usage.inputTokens);const cacheWrite=Math.min(usage.cacheWriteInputTokens??0,usage.inputTokens-cached);
  return ((usage.inputTokens-cached-cacheWrite)*price.input+cached*(price.cachedInput ?? price.input)+cacheWrite*(price.cacheWriteInput ?? price.input)+usage.outputTokens*price.output)/1_000_000;
}
function record(value:unknown):Record<string,unknown>{return value && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};}
function parseArguments(json:string):Record<string,unknown>{const value:unknown=JSON.parse(json);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Tool arguments must be an object");return value as Record<string,unknown>;}
function isStream(value:unknown):value is ReadableStream<Uint8Array>{return Boolean(value&&typeof (value as ReadableStream).getReader==="function");}
