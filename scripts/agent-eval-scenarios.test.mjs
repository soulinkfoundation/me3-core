import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentEvalScenarios, snapshotEvalState, auditEvalWrites } from "./agent-eval-scenarios.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

test("65 independent scenarios include multi-turn and cross-domain ambiguity controls", () => {
  const cases = createAgentEvalScenarios("2026-10-10");
  assert.equal(cases.length, 65);
  assert.equal(new Set(cases.map((item) => item.id)).size, 65);
  assert.ok(cases.filter((item) => item.turns.length > 1).length >= 8);
  assert.ok(cases.some((item) => item.id === "contacts-journal-ambiguity"));
  assert.ok(cases.every((item) => item.rubric && typeof item.check === "function"));
  const latest=cases.find(item=>item.id==="selection-latest-domain");
  assert.equal(latest.turns.at(-1).prompt,"The second one.");
  assert.ok(latest.turns.at(-1).calls.some(call=>call.name==="core_mission_task_update"&&call.arguments.status==="done"));
  const mixed=cases.find(item=>item.id==="selection-mixed-domains");
  assert.equal(mixed.turns.at(-1).prompt,"The second one.");assert.deepEqual(mixed.allowedWrites,{});
});

test("calendar creation controls supply the scheduled title, date, time and duration without imaginary retry context",()=>{
  const cases=createAgentEvalScenarios("2026-10-10").filter(item=>item.id.startsWith("calendar-create"));
  for(const item of cases) {
    assert.match(item.turns[0].prompt,/planning review/i,item.id);
    assert.match(item.turns[0].prompt,/tomorrow/i,item.id);
    assert.match(item.turns[0].prompt,/(?:2\s*pm|14:00)/i,item.id);
    assert.match(item.turns[0].prompt,/45[-\s]*(?:minutes|minute)/i,item.id);
  }
  for(const item of createAgentEvalScenarios("2026-10-10").filter(item=>item.id.startsWith("reminder-create")))assert.match(item.turns[0].prompt,/(?:9\s*am|09:00|morning)/i,item.id);
});

test("contacts follow-up permits reuse of the grounded private list and rejects absent or public discovery",()=>{
  const item=createAgentEvalScenarios("2026-10-10").find(item=>item.id==="contacts-pronoun-list");
  assert.equal(item.check(null,[{tool_name:"core_contacts_search",result_json:JSON.stringify({result:{contacts:[{id:"eval-contact-1",name:"Ada Example"}]}})}]),true);
  assert.equal(item.check(null,[]),false);
  assert.equal(item.check(null,[{tool_name:"core_contacts_search"},{tool_name:"core_people_search"}]),false);
});

test("saved-draft readback accepts a searched source and one read of the actual draft, rejecting source-only reads",async()=>{
  const seed=createSeededAgentEvalInstallation("2026-10-10");
  try {
    const {draft}=await createSeededEvalServices(seed).mailbox.createDraft({to:"ada@example.invalid",subject:"Launch review",body:"Thursday afternoon works."},"test-draft");
    const item=createAgentEvalScenarios("2026-10-10").find(item=>item.id==="mailbox-keywords-draft-read");
    const read=(id)=>({tool_name:"core_mailbox_read",result_json:JSON.stringify({result:{message:{id}}})});
    assert.equal(item.check(seed,[read(draft.id)]),true);
    assert.equal(item.check(seed,[read("eval-email-ada"),read("eval-email-ada")]),false);
    assert.equal(item.check(seed,[]),false);
  }finally{seed.close();}
});

test("write audit catches wrong-record changes and out-of-scope mutations", () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const before = snapshotEvalState(seed);
    seed.raw.prepare("UPDATE user_calendar_events SET title = 'Changed' WHERE id = 'other-event'").run();
    seed.raw.prepare("UPDATE journal_entries SET body = 'Changed'").run();
    const safety = auditEvalWrites(before, snapshotEvalState(seed), { allowedWrites: { user_calendar_events: ["eval-planning"] } });
    assert.equal(safety.wrongRecordWrites, 1);
    assert.equal(safety.unauthorizedWrites, 1);
  } finally { seed.close(); }
});
