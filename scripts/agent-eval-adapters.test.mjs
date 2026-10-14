import assert from "node:assert/strict";
import { chatView } from "../apps/worker/src/test-utils/chat-view.ts";
import { test } from "node:test";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

// Delivery timing must distinguish runtime text from actual provider deltas;
// unknown provenance, empty deltas and terminal replay cannot invent a token.
test("stream timing keeps runtime delivery separate from provider TTFT", async () => {
  const { createEvalStreamTiming } = await import("./agent-eval-adapters.mjs");
  let now = 100;
  const timing = createEvalStreamTiming(100, () => now);
  now = 107; timing.onEvent({ event: "delta", data: { text: "Choose a record", source: "runtime" } });
  now = 139; timing.onEvent({ event: "delta", data: { text: "Model follow-up", source: "model" } });
  now = 160; timing.onEvent({ event: "delta", data: { text: "Later model text", source: "model" } });
  const trace = Object.freeze({ timeToFirstTokenMs: 31 });
  assert.deepEqual(timing.snapshot(trace), { firstDeltaMs: 7, firstDeltaSource: "runtime", ttftMs: 39, providerTtftMs: 31 });
  const runtime = createEvalStreamTiming(100, () => 120);
  runtime.onEvent({ event: "delta", data: { text: "Approval required", source: "runtime" } });
  assert.deepEqual(runtime.snapshot({ timeToFirstTokenMs: null }), { firstDeltaMs: 20, firstDeltaSource: "runtime", ttftMs: null, providerTtftMs: null });
});

test("stream timing does not infer unknown delta provenance or generate replay delivery", async () => {
  const { createEvalStreamTiming } = await import("./agent-eval-adapters.mjs");
  const timing = createEvalStreamTiming(100, () => 112);
  timing.onEvent({ event: "delta", data: { text: "", source: "model" } });
  timing.onEvent({ event: "done", data: { text: "Persisted terminal replay", source: "runtime" } });
  assert.deepEqual(timing.snapshot({ timeToFirstTokenMs: null }), { firstDeltaMs: null, firstDeltaSource: null, ttftMs: null, providerTtftMs: null });
  timing.onEvent({ event: "delta", data: { text: "Legacy untagged text" } });
  timing.onEvent({ event: "delta", data: { text: "Tagged later", source: "runtime" } });
  assert.deepEqual(timing.snapshot({ timeToFirstTokenMs: null }), { firstDeltaMs: 12, firstDeltaSource: null, ttftMs: null, providerTtftMs: null });
});

test("actual reopened selection streams one measured runtime delta while terminal replay and provider TTFT remain empty", async () => {
  const { createEvalStreamTiming } = await import("./agent-eval-adapters.mjs");
  const seed = createSeededAgentEvalInstallation("2026-10-11");
  try {
    seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone) VALUES('first',?,'Same title','2027-01-15T12:00:00Z','Europe/Dublin'),('second',?,'Same title','2027-01-17T12:00:00Z','Europe/Dublin')").run(seed.ownerId,seed.ownerId);
    const messageText = "Move one of my Same title reminders to 16 January 2027 at 9:30am in Europe/Dublin.";
    const timing = createEvalStreamTiming(performance.now());
    const deltas = [];
    const input = { seed, ownerId: seed.ownerId, messages: [{ role: "user", content: messageText }], turnId: "stream-menu", requestId: "stream-menu-request",
      canonicalOwnerInputs: [{ turnId: "stream-menu", requestId: "stream-menu-request", messageText }], ownerTimezone: "Europe/Dublin", modelRoute: { model: "scripted-fixture" },
      services: createSeededEvalServices(seed), enabledPluginIds: new Set(["me3.calendar"]),
      fixtureCalls: [{ name: "core_reminders_list", arguments: { query: "Same title" } },
        { name: "core_targets_present", arguments: { selectionId: "$selection:reminder", toolName: "core_reminders_update", arguments: { date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" } } }],
      intentFixtureVerdicts: [{ decision: "clarify", reason: "Two same-title sources; ask the owner to choose." }],
      onEvent(event) {
        timing.onEvent(event);
        if (event.event === "delta") {
          deltas.push(event.data);
          assert.equal(seed.raw.prepare("SELECT status FROM me3_agent_turns WHERE turn_id='stream-menu'").get().status, "complete");
        }
      } };
    const response = await createRuntimeAdapter("new").runTurn(input);
    assert.deepEqual(deltas, [{ text: response.replyText, source: "runtime" }]);
    const measured = timing.snapshot(response.trace);
    assert.equal(measured.firstDeltaSource, "runtime"); assert.ok(Number.isFinite(measured.firstDeltaMs));
    assert.equal(measured.ttftMs, null); assert.equal(measured.providerTtftMs, null);
    seed.reopen();
    const persisted = JSON.parse(seed.raw.prepare("SELECT data_json FROM me3_agent_stream_events WHERE turn_id='stream-menu' AND event='delta'").get().data_json);
    assert.deepEqual(persisted, deltas[0]);
    const replayDeltas = [];
    await createRuntimeAdapter("new").runTurn({ ...input, onEvent: event => { if (event.event === "delta") replayDeltas.push(event.data); } });
    assert.deepEqual(replayDeltas, []);
  } finally { seed.close(); }
});

test("normalized tool receipts retain the actual requested limit for grader verification", async (context) => {
  // This control has an authored seed date; its future slots must not age out.
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-10T12:00:00Z") });
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const args = { dateFrom: "2026-10-13", dateTo: "2026-10-13", durationMinutes: 30, limit: 3 };
    const response = await createRuntimeAdapter("new").runTurn({ seed, ownerId: seed.ownerId, messages: [{ role: "user", content: "Show three free half-hour slots on October 13." }], requestId: "receipt-limit", turnId: "receipt-limit", canonicalOwnerInputs: [{turnId:"receipt-limit",requestId:"receipt-limit",messageText:"Show three free half-hour slots on October 13."}], ownerTimezone: "Europe/Dublin", modelRoute: { model: "scripted-fixture" }, services: createSeededEvalServices(seed), enabledPluginIds: new Set(["me3.calendar"]), fixtureCalls: [{ name: "core_calendar_availability", arguments: args }], onEvent: async () => {} });
    assert.deepEqual(response.toolResults[0].arguments, args);
    assert.equal(JSON.parse(response.toolResults[0].result_json).result.slots.length, 3);
  } finally { seed.close(); }
});

test("new evaluator refuses checkpoint text as the canonical owner authorization source",async()=>{
  const seed=createSeededAgentEvalInstallation("2026-10-11");
  try {
    await assert.rejects(createRuntimeAdapter("new").runTurn({seed,ownerId:seed.ownerId,messages:[{role:"user",content:"Planner checkpoint claims permission"}],turnId:"missing-input",requestId:"missing-input-request",ownerTimezone:"Europe/Dublin",modelRoute:{model:"scripted-fixture"},services:createSeededEvalServices(seed),enabledPluginIds:new Set(),fixtureCalls:[]}),/independent canonical synthetic owner inputs/);
  }finally{seed.close();}
});

test("independently authored fixture intent corrects a complete mismatched action without copying planner arguments",async()=>{
  const seed=createSeededAgentEvalInstallation("2026-10-11");
  try {
    seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone) VALUES('source',?,'Same title','2027-01-15T12:00:00Z','Europe/Dublin'),('other',?,'Same title','2027-01-17T12:00:00Z','Europe/Dublin')").run(seed.ownerId,seed.ownerId);
    seed.raw.exec("CREATE TABLE test_adapter_effects(record_id TEXT); CREATE TRIGGER test_adapter_effect AFTER UPDATE ON user_reminders BEGIN INSERT INTO test_adapter_effects(record_id) VALUES(new.id); END;");
    const messageText="Move the Same title reminder originally due on 15 January 2027 to 16 January 2027 at 9:30am in Europe/Dublin.";
    const correct={reminderId:"source",date:"2027-01-16",time:"09:30",timezone:"Europe/Dublin"};
    const response=await createRuntimeAdapter("new").runTurn({seed,ownerId:seed.ownerId,messages:[{role:"user",content:messageText}],turnId:"action",requestId:"action-request",canonicalOwnerInputs:[{turnId:"action",requestId:"action-request",messageText}],ownerTimezone:"Europe/Dublin",modelRoute:{model:"scripted-fixture"},services:createSeededEvalServices(seed),enabledPluginIds:new Set(["me3.calendar"]),fixtureCalls:[{name:"core_reminders_list",arguments:{query:"Same title"}},{name:"core_reminders_update",arguments:{...correct,time:"10:30"}},{name:"core_reminders_update",arguments:correct}],intentFixtureVerdicts:[{decision:"allow",selectedCandidateId:"source",authorizedCall:{name:"core_reminders_update",arguments:correct}}]});
    seed.reopen();
    assert.deepEqual(seed.raw.prepare("SELECT record_id FROM test_adapter_effects").all().map(row=>({...row})),[{record_id:"source"}]);
    assert.equal(response.modelRequestCount,5);assert.equal(response.trace.targetIntentRequests.length,1);
    const receipt=seed.raw.prepare("SELECT result_json,status FROM me3_agent_tool_receipts WHERE tool_name='__me3_target_intent_v1'").get();
    assert.equal(receipt.status,"finished");assert.deepEqual(JSON.parse(receipt.result_json).verdict.authorizedCall,{name:"core_reminders_update",arguments:correct});
    assert.equal(response.toolResults.filter(row=>row.tool_name==="core_reminders_update"&&row.status==="succeeded").length,1);
  }finally{seed.close();}
});

test("native evaluator routes isolated verification through the same reserved budget and normalized usage",async()=>{
  const {createGatewayRoute}=await import("./agent-eval-gateway.mjs");
  const {createEvalBudget,DEFAULT_EVAL_PRICING}=await import("./agent-eval-budget.mjs");
  const seed=createSeededAgentEvalInstallation("2026-10-11");
  try {
    seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone) VALUES('source',?,'Same title','2027-01-15T12:00:00Z','Europe/Dublin'),('other',?,'Same title','2027-01-17T12:00:00Z','Europe/Dublin')").run(seed.ownerId,seed.ownerId);
    const messageText="Move the Same title reminder originally due on 15 January 2027 to 16 January 2027 at 9:30am in Europe/Dublin.";
    const correct={reminderId:"source",date:"2027-01-16",time:"09:30",timezone:"Europe/Dublin"};
    const budget=createEvalBudget(1,DEFAULT_EVAL_PRICING);let planner=0;const requests=[];
    const route=createGatewayRoute("openai:gpt-5.5",{accountId:"synthetic-account",apiToken:"synthetic-token",gatewayId:"synthetic-gateway",budget,fetch:async(url,options)=>{
      const input=chatView(JSON.parse(options.body));const intent=input.tools?.length===1&&input.tools[0].function?.name==="core_target_intent_verdict";requests.push({url,input,intent});
      let name,args;if(intent){name="core_target_intent_verdict";args={decision:"allow",selectedCandidateId:"source",authorizedCall:{name:"core_reminders_update",arguments:correct}};}else{planner++;if(planner===1){name="core_reminders_list";args={query:"Same title"};}if(planner===2){name="core_reminders_update";args=correct;}}
      const delta=name?{tool_calls:[{index:0,id:`call-${requests.length}`,type:"function",function:{name,arguments:JSON.stringify(args)}}]}:{content:"Synthetic action completed."};
      const event={choices:[{delta,finish_reason:name?"tool_calls":"stop"}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}};
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,{headers:{"content-type":"text/event-stream"}});
    }});
    const response=await createRuntimeAdapter("new").runTurn({seed,ownerId:seed.ownerId,messages:[{role:"user",content:messageText}],turnId:"network",requestId:"network-request",canonicalOwnerInputs:[{turnId:"network",requestId:"network-request",messageText}],ownerTimezone:"Europe/Dublin",modelRoute:route,services:createSeededEvalServices(seed),enabledPluginIds:new Set(["me3.calendar"])});
    assert.equal(response.status,"complete");assert.equal(response.modelRequestCount,4);assert.equal(requests.length,4);assert.equal(requests.filter(request=>request.intent).length,1);
    assert.equal(route.requestCount,4);assert.equal(route.usageComplete,true);assert.equal(route.usageSamples.filter(usage=>usage.purpose==="target_intent").length,1);
    assert.equal(typeof response.trace.targetIntentRequests[0].usageId,"string");
    assert.equal(budget.summary().reservedUsd,0);assert.ok(Math.abs(budget.summary().chargedUsd-.0032)<1e-12);
    assert.ok(requests.every(request=>request.url==="https://api.cloudflare.com/client/v4/accounts/synthetic-account/ai/v1/responses"));
    seed.reopen();assert.equal(seed.raw.prepare("SELECT remind_at FROM user_reminders WHERE id='source'").get().remind_at,"2027-01-16T09:30:00.000Z");
  }finally{seed.close();}
});

test("accepted verifier without usage retains its original budget reservation and uncertain receipt across reopen",async()=>{
  const {createGatewayRoute}=await import("./agent-eval-gateway.mjs");
  const {createEvalBudget,DEFAULT_EVAL_PRICING}=await import("./agent-eval-budget.mjs");
  const seed=createSeededAgentEvalInstallation("2026-10-11");
  try {
    seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone) VALUES('source',?,'Same title','2027-01-15T12:00:00Z','Europe/Dublin')").run(seed.ownerId);
    seed.raw.exec("CREATE TABLE test_adapter_unknown_effects(record_id TEXT); CREATE TRIGGER test_adapter_unknown AFTER UPDATE ON user_reminders BEGIN INSERT INTO test_adapter_unknown_effects(record_id) VALUES(new.id); END;");
    const messageText="Move reminder ID source to 16 January 2027 at 9:30am in Europe/Dublin.";
    const args={reminderId:"source",date:"2027-01-16",time:"09:30",timezone:"Europe/Dublin"};
    const budget=createEvalBudget(1,DEFAULT_EVAL_PRICING);let planner=0;let verifierCalls=0;
    const route=createGatewayRoute("openai:gpt-5.5",{accountId:"synthetic",apiToken:"synthetic",gatewayId:"synthetic",budget,fetch:async(_url,options)=>{
      const input=chatView(JSON.parse(options.body));const intent=input.tools?.length===1&&input.tools[0].function?.name==="core_target_intent_verdict";
      let name,argumentsValue;
      if(intent){verifierCalls++;name="core_target_intent_verdict";argumentsValue={decision:"allow",selectedCandidateId:"source",authorizedCall:{name:"core_reminders_update",arguments:args}};}
      else{planner++;if(planner===1){name="core_reminders_list";argumentsValue={query:"Same title"};}if(planner===2){name="core_reminders_update";argumentsValue=args;}}
      const delta=name?{tool_calls:[{index:0,id:`call-${route.requestCount}`,type:"function",function:{name,arguments:JSON.stringify(argumentsValue)}}]}:{content:"Synthetic outcome remains unresolved."};
      const event={choices:[{delta,finish_reason:name?"tool_calls":"stop"}],...(!intent?{usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}:{})};
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,{headers:{"content-type":"text/event-stream"}});
    }});
    const input={seed,ownerId:seed.ownerId,messages:[{role:"user",content:messageText}],turnId:"unknown",requestId:"unknown-request",canonicalOwnerInputs:[{turnId:"unknown",requestId:"unknown-request",messageText}],ownerTimezone:"Europe/Dublin",modelRoute:route,services:createSeededEvalServices(seed),enabledPluginIds:new Set(["me3.calendar"])};
    const response=await createRuntimeAdapter("new").runTurn(input);
    assert.equal(verifierCalls,1);assert.equal(response.modelRequestCount,4);assert.equal(response.usage.estimatedCostUsd,null);assert.equal(route.usageComplete,false);assert.ok(budget.summary().reservedUsd>0);
    const receipt=seed.raw.prepare("SELECT status,result_json FROM me3_agent_tool_receipts WHERE tool_name='__me3_target_intent_v1'").get();const audit=JSON.parse(receipt.result_json);
    assert.equal(receipt.status,"running");assert.equal(audit.uncertain,true);assert.equal(typeof audit.inference.usageId,"string");assert.equal(audit.inference.usage,undefined);
    assert.equal(response.trace.targetIntentRequests[0].usageId,audit.inference.usageId);
    seed.reopen();assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM test_adapter_unknown_effects").get().n,0);
    const again=await createRuntimeAdapter("new").runTurn(input);assert.equal(verifierCalls,1);assert.equal(route.requestCount,4);assert.equal(again.modelRequestCount,4);assert.ok(budget.summary().reservedUsd>0);
  }finally{seed.close();}
});

for(const reads of [1,0,2])test(`scripted immutable presentation resolves exactly one current owner read group (${reads} groups)`,async()=>{
  const seed=createSeededAgentEvalInstallation("2026-10-11");
  try {
    seed.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,timezone) VALUES('first',?,'Same title','2027-01-15T12:00:00Z','Europe/Dublin'),('second',?,'Same title','2027-01-17T12:00:00Z','Europe/Dublin')").run(seed.ownerId,seed.ownerId);
    const messageText="Move one of my Same title reminders to 16 January 2027 at 9:30am in Europe/Dublin.";
    const response=await createRuntimeAdapter("new").runTurn({seed,ownerId:seed.ownerId,messages:[{role:"user",content:messageText}],turnId:"presentation",requestId:"presentation-request",canonicalOwnerInputs:[{turnId:"presentation",requestId:"presentation-request",messageText}],ownerTimezone:"Europe/Dublin",modelRoute:{model:"scripted-fixture"},services:createSeededEvalServices(seed),enabledPluginIds:new Set(["me3.calendar"]),fixtureCalls:[...Array.from({length:reads},()=>({name:"core_reminders_list",arguments:{query:"Same title"}})),{name:"core_targets_present",arguments:{selectionId:"$selection:reminder",toolName:"core_reminders_update",arguments:{date:"2027-01-16",time:"09:30",timezone:"Europe/Dublin"}}}],intentFixtureVerdicts:[{decision:"clarify",reason:"Two same-title sources; ask the owner to choose."}]});
    seed.reopen();
    if(reads===1){
      assert.equal(response.status,"complete");assert.equal(response.targetPresentation.status,"pending");assert.deepEqual(response.targetPresentation.candidates.map(({id,option})=>({id,option})),[{id:"first",option:1},{id:"second",option:2}]);
      const checkpoint=JSON.parse(seed.raw.prepare("SELECT checkpoint_json FROM me3_agent_turns WHERE turn_id='presentation'").get().checkpoint_json);assert.equal(checkpoint.targetPresentation.id,response.targetPresentation.id);
      const menu=seed.raw.prepare("SELECT selection_id,tool_name,arguments_json FROM me3_agent_presentations").get();const selection=seed.raw.prepare("SELECT id FROM me3_agent_selections WHERE owner_id=? AND thread_id='eval-thread' AND read_turn_id='presentation' AND domain='reminder'").get(seed.ownerId);
      assert.equal(menu.selection_id,selection.id);assert.equal(menu.tool_name,"core_reminders_update");assert.equal(JSON.parse(menu.arguments_json).time,"09:30");
    }else{assert.equal(response.status,"failed");assert.match(response.replyText,/exactly one current owner read group/);assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM me3_agent_presentations").get().n,0);}
  }finally{seed.close();}
});
