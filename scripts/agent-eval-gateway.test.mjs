import assert from "node:assert/strict";
import { test } from "node:test";
import { createGatewayRoute } from "./agent-eval-gateway.mjs";

test("streaming model calls return the real provider stream without buffering", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')); controller.close(); } });
  let request;
  const route = createGatewayRoute("openai:test", { accountId: "synthetic", apiToken: "synthetic-token", gatewayId: "eval", fetch: async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  } });
  assert.equal(await route.ai.run("openai/test", { messages: [], stream: true }), body);
  assert.equal(request.stream, true);
});

test("a buffered JSON response cannot silently become streaming TTFT evidence", async () => {
  const route = createGatewayRoute("openai:test", { accountId: "synthetic", apiToken: "synthetic-token", fetch: async () => new Response('{"result":{"response":"Hi"}}', { headers: { "content-type": "application/json" } }) });
  await assert.rejects(route.ai.run("openai/test", { stream: true }), /stream/i);
});

test("cost evidence remains incomplete until every candidate request reports usage", async () => {
  const route = createGatewayRoute("openai:test", { accountId: "synthetic", apiToken: "synthetic", fetch: async () => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }) });
  await route.ai.run("openai/test", { stream: true });
  assert.equal(route.usageComplete, false);
  const usage = { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 };
  route.recordUsage({ usage }); assert.equal(route.usageComplete, true);
  await route.ai.run("openai/test", { stream: true }); assert.equal(route.usageComplete, false);
});

test("native streaming requests use their documented Cloudflare compatibility endpoint", async () => {
  for(const [model,input,path] of [["openai/gpt-6.1-sol",{input:[],stream:true},"responses"],["anthropic/claude-opus-5.5",{messages:[],stream:true},"messages"],["openai/gpt-5.5",{messages:[],stream:true},"chat/completions"]]) {
    let sent;let url;
    const route=createGatewayRoute(model.replace("/",":"),{accountId:"synthetic",apiToken:"synthetic",fetch:async(target,options)=>{url=target;sent=JSON.parse(options.body);return new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});
    await route.ai.run(model,input);
    assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/synthetic/ai/v1/${path}`);
    assert.deepEqual(sent,{model,...input});
  }
});
