import assert from "node:assert/strict";
import { test } from "node:test";
import { createGatewayRoute, gradeAgentReply } from "./agent-eval-gateway.mjs";
import { createEvalBudget, DEFAULT_EVAL_PRICING } from "./agent-eval-budget.mjs";

test("explicit Sonnet grader uses native shared-model requests and normalized cache usage", async () => {
  let model; let sent;
  const json = JSON.stringify({ answered: 1, honest: 1, clarified: 1, concise: 1, reason: "Grounded." });
  const response = await gradeAgentReply({ graderModel: "anthropic:claude-sonnet-5.5", scenario: { rubric: "Grounded response." }, messages: [], toolResults: [], stateCheckPassed: true,
    route: { aiGateway: { gatewayId: "eval" }, ai: { async run(selected, input) { model = selected; sent = input; return { content: [{ type: "text", text: json }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } }; } } } });
  assert.equal(model, "anthropic/claude-sonnet-5.5");
  assert.equal(typeof sent.system, "string"); assert.equal(sent.stream, true); assert.equal(sent.max_tokens, 2000);
  assert.equal(sent.messages[0].role, "user");
  assert.equal(response.grade.passed, true);
  assert.deepEqual(response.usage && { input: response.usage.inputTokens, output: response.usage.outputTokens, cached: response.usage.cachedInputTokens, writes: response.usage.cacheWriteInputTokens }, { input: 160, output: 20, cached: 50, writes: 10 });
});

test("valid grader JSON with absent or malformed usage retains its cost reservation", async () => {
  for (const usage of [undefined, {}, { input_tokens: -1, output_tokens: 10 }, { input_tokens: 100 }, { input_tokens: 100, output_tokens: "10" }]) {
    const budget = createEvalBudget(1, DEFAULT_EVAL_PRICING);
    const json = JSON.stringify({ answered: 1, honest: 1, clarified: 1, concise: 1, reason: "Grounded." });
    const frames = [{ type: "message_start", message: { usage } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json } }, { type: "message_stop" }];
    const route = createGatewayRoute("anthropic:claude-sonnet-5.5", { accountId: "synthetic", apiToken: "synthetic", budget, fetch: async () => new Response(frames.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }) });
    const result = await gradeAgentReply({ graderModel: "anthropic:claude-sonnet-5.5", scenario: { rubric: "Grounded." }, messages: [], toolResults: [], stateCheckPassed: true, route });
    assert.equal(result.grade.passed, true); assert.equal(result.usage, null);
    assert.equal(budget.summary().chargedUsd, 0); assert.ok(budget.summary().reservedUsd > 0);
  }
});

test("later known usage settles that request without releasing an earlier unknown reservation", async () => {
  let next = 0; const settled = [];
  const route = createGatewayRoute("openai:test", { accountId: "synthetic", apiToken: "synthetic", budget: { reserve: () => ++next, settle: (id, usage) => settled.push({ id, usage }) }, fetch: async () => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }) });
  await route.ai.run("openai/test", { stream: true });
  await route.ai.run("openai/test", { stream: true });
  route.recordUsage({ usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 } });
  assert.equal(settled[0].id, 2); assert.equal(route.usageComplete, false);
});

test("shared grader still rejects malformed scores and invented tool invocations", async () => {
  const input = { scenario: { rubric: "Answer." }, messages: [], toolResults: [], stateCheckPassed: true };
  await assert.rejects(gradeAgentReply({ ...input, route: { ai: { async run() { return { response: '{"answered":1}' }; } } } }), /grader/i);
  await assert.rejects(gradeAgentReply({ ...input, route: { ai: { async run() { return { choices: [{ message: { content: '{"answered":1,"honest":1,"clarified":1,"concise":1,"reason":"OK"}', tool_calls: [{ id: "bad", function: { name: "not-a-grader-tool", arguments: "{}" } }] } }] }; } } } }), /tool/i);
});

test("grader sees used trusted contracts and recorded invocation arguments, without unused schemas or executors", async () => {
  let sent;
  const grade = { answered: 1, honest: 1, clarified: 1, concise: 1, reason: "Confirmed is supported by the used tool contract." };
  await gradeAgentReply({ scenario: { rubric: "Report the real booking." }, messages: [{ role: "assistant", content: "One confirmed booking." }],
    toolResults: [{ tool_name: "core_bookings_lookup", arguments: { limit: 1 }, result_json: "{\"result\":{\"bookings\":[]}}" }], stateCheckPassed: true,
    toolContracts: [{ name: "core_bookings_lookup", description: "Read upcoming confirmed bookings.", effect: "read", approval: "none", parameters: { secretUnused: true }, execute() {} }, { name: "core_contacts_search", description: "Unused private contacts.", effect: "read", approval: "none" }],
    route: { ai: { async run(_model, input) { sent = input; return { choices: [{ message: { content: JSON.stringify(grade) } }] }; } } },
  });
  const prompt = sent.messages[1].content;
  const evidence = JSON.parse(prompt.slice(prompt.indexOf("{")));
  assert.deepEqual(evidence.toolContracts, [{ name: "core_bookings_lookup", description: "Read upcoming confirmed bookings.", effect: "read", approval: "none" }]);
  assert.deepEqual(evidence.toolResults[0].arguments, { limit: 1 });
  assert.match(prompt, /contract.*trusted|trusted.*contract/i);
});

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
  for(const [model,input,path] of [["openai/gpt-6.1-sol",{input:[],stream:true},"responses"],["anthropic/claude-opus-5.5",{messages:[],stream:true},"messages"],["openai/gpt-5.5",{messages:[],stream:true},"chat/completions"],["@cf/zai-org/glm-5.3-flash",{messages:[],stream:true},"chat/completions"],["@cf/openai/gpt-oss-120b",{messages:[],stream:true},"chat/completions"]]) {
    let sent;let url;
    const route=createGatewayRoute(model.replace("/",":"),{accountId:"synthetic",apiToken:"synthetic",fetch:async(target,options)=>{url=target;sent=JSON.parse(options.body);return new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});
    await route.ai.run(model,input);
    assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/synthetic/ai/v1/${path}`);
    assert.deepEqual(sent,{model,...input});
  }
});

test("buffered usage settles cache writes at their distinct published price", async () => {
  let settled;
  const route = createGatewayRoute("openai:gpt-6-astra", {
    accountId: "synthetic", apiToken: "synthetic",
    budget: { reserve: () => "reservation", settle: (id, usage) => { settled = { id, usage }; } },
    fetch: async () => Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 100 } } }),
  });
  await route.ai.run("openai/gpt-6-astra", { messages: [], stream: false });
  assert.deepEqual(settled, { id: "reservation", usage: { inputTokens: 1000, outputTokens: 10, cachedInputTokens: 600, cacheWriteInputTokens: 100 } });
});

test("buffered present-but-invalid token fields stay unknown instead of settling as zero", async () => {
  for (const usage of [{ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: null } }, { prompt_tokens: 100, completion_tokens: 20, cache_creation_input_tokens: null }, { prompt_tokens: null, input_tokens: 100, completion_tokens: 20 }]) {
    let settled;
    const route = createGatewayRoute("openai:gpt-5.5", { accountId: "synthetic", apiToken: "synthetic", budget: { reserve: () => "unknown", settle: (_id, value) => { settled = value; } }, fetch: async () => Response.json({ usage }) });
    await route.ai.run("openai/gpt-5.5", { messages: [], stream: false });
    assert.equal(settled, null);
  }
});
