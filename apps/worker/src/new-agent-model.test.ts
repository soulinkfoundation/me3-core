import { describe, expect, it } from "vitest";
import { createCloudflareModel } from "../../../packages/agent/src/model";
import type { AgentTool } from "../../../packages/agent/src/types";

const tool: AgentTool = {name:"save",description:"Save",effect:"write",approval:"none",parameters:{type:"object",properties:{title:{type:"string"}},required:["title"],additionalProperties:false},execute:async()=>({status:"ok"})};
function stream(events: unknown[], done = true) {
  const text = events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join("")+(done ? "data: [DONE]\r\n\r\n" : "");
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}});
}
describe("new agent Cloudflare model transport", () => {
  it("keeps Anthropic initial usage provisional until final output usage arrives", async () => {
    for (const final of [undefined, {}, {output_tokens: null}, {output_tokens: -1}]) {
      let recorded = false;
      const model = createCloudflareModel({model: "anthropic/claude-sonnet-5.5", gatewayId: "test", recordUsage: () => { recorded = true; }, ai: {run: async () => stream([
        {type: "message_start", message: {usage: {input_tokens: 100, output_tokens: 0}}},
        {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "Ready"}},
        ...(final === undefined ? [] : [{type: "message_delta", usage: final}]),
        {type: "message_stop"},
      ])}});
      const result = await model.step({messages: [], tools: [], signal: new AbortController().signal, onDelta: async () => {}});
      expect(result.text).toBe("Ready");
      expect(result.usage).toBeUndefined();
      expect(recorded).toBe(false);
    }
  });
  it("keeps malformed or incomplete provider usage unknown instead of recording a free call", async () => {
    for (const usage of [{}, {prompt_tokens: 100}, {prompt_tokens: "", completion_tokens: 0}, {prompt_tokens: null, completion_tokens: 0}, {prompt_tokens: 100, completion_tokens: -1}, {prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: {cached_tokens: 101}}, {prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: {cached_tokens: null}}]) {
      let recorded = false;
      const model = createCloudflareModel({model: "openai/gpt-6.1-sol", gatewayId: "test", recordUsage: () => { recorded = true; }, ai: {run: async () => ({choices: [{message: {content: "Ready"}}], usage})}});
      const result = await model.step({messages: [], tools: [], signal: new AbortController().signal, onDelta: async () => {}});
      expect(result.text).toBe("Ready");
      expect(result.usage).toBeUndefined();
      expect(recorded).toBe(false);
    }
  });
  it("accounts for existing managed defaults and the hosted budget fallback", async () => {
    for (const [name, expected] of [["openai/gpt-5.4-mini", 0.00039], ["openai/gpt-5.4-nano", 0.0001045], ["@cf/zai-org/glm-4.7-flash", 0.0000645]] as const) {
      const model = createCloudflareModel({ model: name, gatewayId: "test", ai: { run: async () => ({
        choices: [{ message: { content: "Ready" } }], usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 600 } },
      }) } });
      const result = await model.step({ messages: [], tools: [], signal: new AbortController().signal, onDelta: async () => {} });
      expect(result.usage?.estimatedCostUsd, name).toBeCloseTo(expected, 12);
    }
  });
  it("streams OpenAI fragmented calls, usage and images through the AI binding and Gateway", async () => {
    let request: Record<string,unknown> = {}; let options: unknown;
    const model = createCloudflareModel({model:"openai/gpt-5.5",gatewayId:"test",metadata:{turn:"synthetic"},ai:{run:async(_model,input,opts)=>{request=input;options=opts;return stream([
      {choices:[{delta:{content:"Working"}}]},
      {choices:[{delta:{tool_calls:[{index:0,id:"call",function:{name:"save",arguments:'{"title":'}}]}}]},
      {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"hello"}'}}]}}]},
      {usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:30}},choices:[]},
    ]);}}});
    const deltas:string[]=[];
    const result = await model.step({messages:[{role:"user",content:"Read image",images:[{url:"data:image/png;base64,AA=="}]}],tools:[tool],signal:new AbortController().signal,onDelta:async t=>{deltas.push(t);}});
    expect(deltas).toEqual(["Working"]);expect(result.toolCalls[0].arguments).toEqual({title:"hello"});
    expect(result.usage?.cachedInputTokens).toBe(30);expect(result.usage?.estimatedCostUsd).toBeGreaterThan(0);
    expect(JSON.stringify(request)).toContain("image_url"); expect(options).toMatchObject({gateway:{id:"test",metadata:{turn:"synthetic"}}});
  });
  it("uses Responses for GPT-6 tools and preserves call IDs and tool results", async () => {
    let request:Record<string,unknown>={};
    const model=createCloudflareModel({model:"openai/gpt-6.1-sol",gatewayId:"test",ai:{run:async(_,input)=>{request=input;return stream([
      {type:"response.output_item.added",output_index:0,item:{type:"function_call",id:"item",call_id:"call",name:"save",arguments:""}},
      {type:"response.function_call_arguments.delta",output_index:0,delta:'{"title":"hello"}'},
      {type:"response.output_text.delta",delta:"Saved"},
      {type:"response.completed",response:{status:"completed",usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:30,cache_write_tokens:10}}}},
    ]);}}});
    const result=await model.step({messages:[{role:"system",content:"Help"},{role:"user",content:"Save",images:[{url:"data:image/png;base64,AA=="}]},{role:"assistant",content:"",toolCalls:[{id:"old",name:"save",arguments:{title:"first"}}]},{role:"tool",content:'{"status":"ok"}',toolCallId:"old"}],tools:[tool],signal:new AbortController().signal,onDelta:async()=>{}});
    expect(request).toHaveProperty("input");expect(request).not.toHaveProperty("messages");
    expect(JSON.stringify(request)).toContain("function_call_output");expect(JSON.stringify(request)).toContain("input_image");
    expect(result.toolCalls[0]).toEqual({id:"call",name:"save",arguments:{title:"hello"}});
    expect(result.usage).toMatchObject({inputTokens:100,outputTokens:20,cachedInputTokens:30,cacheWriteInputTokens:10});
  });
  it("uses Anthropic native tool/history and sums initial input plus final output usage", async () => {
    let request:Record<string,unknown>={};
    const model = createCloudflareModel({model:"anthropic/claude-opus-5.5",gatewayId:"test",ai:{run:async(_,input)=>{request=input;return stream([
      {type:"message_start",message:{usage:{input_tokens:100,cache_read_input_tokens:40,output_tokens:0}}},
      {type:"content_block_start",index:0,content_block:{type:"tool_use",id:"a",name:"save",input:{}}},
      {type:"content_block_delta",index:0,delta:{type:"input_json_delta",partial_json:'{"title":"hello"}'}},
      {type:"message_delta",usage:{output_tokens:10}},
      {type:"message_stop"},
    ]);}}});
    const result=await model.step({messages:[{role:"system",content:"Be useful"},{role:"user",content:"Save"},{role:"assistant",content:"",toolCalls:[{id:"old",name:"save",arguments:{title:"first"}}]},{role:"tool",content:'{"status":"ok"}',toolCallId:"old"}],tools:[tool],signal:new AbortController().signal,onDelta:async()=>{}});
    expect(request.system).toBe("Be useful");
    expect(request.tools).toMatchObject([{cache_control:{type:"ephemeral"}}]);
    expect(JSON.stringify(request)).toContain("tool_result");
    expect(result.usage).toMatchObject({inputTokens:140,outputTokens:10,cachedInputTokens:40});
    expect(result.toolCalls[0].arguments).toEqual({title:"hello"});
  });
  it("rejects EOF after a valid tool fragment without provider completion", async () => {
    const fixtures: Array<[string, unknown[]]> = [
      ["openai/gpt-5.5", [{choices:[{delta:{tool_calls:[{index:0,id:"a",function:{name:"save",arguments:'{"title":"hello"}'}}]}}]}]],
      ["openai/gpt-6.1-sol", [{type:"response.output_item.added",output_index:0,item:{type:"function_call",call_id:"a",name:"save",arguments:'{"title":"hello"}'}}]],
      ["anthropic/claude-opus-5.5", [{type:"content_block_start",index:0,content_block:{type:"tool_use",id:"a",name:"save",input:{title:"hello"}}}]],
    ];
    for (const [name, events] of fixtures) {
      const model=createCloudflareModel({model:name,gatewayId:"test",ai:{run:async()=>stream(events, false)}});
      await expect(model.step({messages:[],tools:[tool],signal:new AbortController().signal,onDelta:async()=>{}})).rejects.toThrow("did not complete");
    }
  });
  it("rejects malformed arguments, truncation and provider errors", async () => {
    for (const events of [
      [{choices:[{delta:{tool_calls:[{index:0,id:"a",function:{name:"save",arguments:'{"title":'}}]},finish_reason:"length"}]}],
      [{error:{message:"Provider unavailable"}}],
    ]) {
      const model=createCloudflareModel({model:"openai/gpt-6.1-sol",gatewayId:"test",ai:{run:async()=>stream(events)}});
      await expect(model.step({messages:[],tools:[tool],signal:new AbortController().signal,onDelta:async()=>{}})).rejects.toThrow();
    }
  });
  it("does not call the provider after cancellation or send external models without Gateway", async () => {
    const controller=new AbortController();controller.abort();let calls=0;
    const model=createCloudflareModel({model:"openai/gpt-6.1-sol",gatewayId:"test",ai:{run:async()=>{calls++;return {};}}});
    await expect(model.step({messages:[],tools:[],signal:controller.signal,onDelta:async()=>{}})).rejects.toThrow(); expect(calls).toBe(0);
    expect(()=>createCloudflareModel({model:"openai/gpt-6.1-sol",ai:{run:async()=>({})}})).toThrow("Gateway");
  });
  it("keeps Cloudflare-hosted OpenAI models in the Workers AI namespace", async () => {
    let selected = "";
    const model = createCloudflareModel({model:"@cf/openai/gpt-oss-120b",ai:{run:async(name)=>{selected=name;return {response:"Ready"};}}});
    const result = await model.step({messages:[{role:"user",content:"Hello"}],tools:[],signal:new AbortController().signal,onDelta:async()=>{}});
    expect(model.id).toBe("@cf/openai/gpt-oss-120b");
    expect(selected).toBe(model.id);
    expect(result.text).toBe("Ready");
  });
  it("charges the published Cloudflare cached-input and cache-write candidate rates", async () => {
    const cases: Array<[string, number]> = [["anthropic/claude-sonnet-5.5",0.00107],["anthropic/claude-sonnet-5",0.00107],["anthropic/claude-sonnet-4.6",0.001605],["moonshotai/kimi-k3",0.00153],["openai/gpt-6-astra",0.0053],["@cf/zai-org/glm-5.3-flash",0.000083]];
    for (const [name, expected] of cases) {
      const raw = name.startsWith("anthropic/")
        ? {content:[{type:"text",text:"Ready"}],usage:{input_tokens:300,output_tokens:10,cache_read_input_tokens:600,cache_creation_input_tokens:100}}
        : {choices:[{message:{content:"Ready"}}],usage:{prompt_tokens:1000,completion_tokens:10,prompt_tokens_details:{cached_tokens:600,cache_write_tokens:100}}};
      const model=createCloudflareModel({model:name,gatewayId:"test",ai:{run:async()=>raw}});
      const result=await model.step({messages:[],tools:[],signal:new AbortController().signal,onDelta:async()=>{}});
      expect(result.usage?.estimatedCostUsd,name).toBeCloseTo(expected,12);
    }
  });
});
