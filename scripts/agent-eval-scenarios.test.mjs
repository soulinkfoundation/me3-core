import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentEvalScenarios, snapshotEvalState, auditEvalWrites } from "./agent-eval-scenarios.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

test("82 independent scenarios retain multi-turn and cross-domain ambiguity controls", () => {
  const cases = createAgentEvalScenarios("2026-10-10");
  assert.equal(cases.length, 82);
  assert.equal(new Set(cases.map((item) => item.id)).size, 82);
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

test("saved-draft readback requires the complete persisted draft, accepting native search or read evidence",async()=>{
  const seed=createSeededAgentEvalInstallation("2026-10-10");
  try {
    const {draft}=await createSeededEvalServices(seed).mailbox.createDraft({to:"ada@example.invalid",subject:"Launch review",body:"Thursday afternoon works."},"test-draft");
    const item=createAgentEvalScenarios("2026-10-10").find(item=>item.id==="mailbox-keywords-draft-read");
    const read=(message)=>({tool_name:"core_mailbox_read",result_json:JSON.stringify({result:{message}})});
    const search=(message)=>({tool_name:"core_mailbox_search",result_json:JSON.stringify({result:{messages:[message]}})});
    assert.equal(item.check(seed,[read(draft)]),true);
    assert.equal(item.check(seed,[search(draft)]),true);
    for (const incomplete of [{id:draft.id}, {...draft,bodyText:"Preview only",body:"Preview only"}, {...draft,status:"sent"}, {...draft,toAddress:"wrong@example.invalid",to:"wrong@example.invalid"}, {...draft,id:"eval-email-ada"}]) {
      assert.equal(item.check(seed,[read(incomplete)]),false);
      assert.equal(item.check(seed,[search(incomplete)]),false);
    }
    assert.equal(item.check(seed,[]),false);
  }finally{seed.close();}
});

test("historical regressions are additive with explicit DST, duplicate and threaded reply checks", () => {
  const cases = createAgentEvalScenarios("2026-10-10");
  const historical = cases.filter(item => item.id.startsWith("historical-"));
  assert.equal(historical.length, 16);
  assert.equal(cases.length, 82);
  assert.ok(historical.every(item => item.historySource && item.rubric));
  const gap = historical.find(item => item.id === "historical-reminder-dst-gap");
  const fold = historical.find(item => item.id === "historical-reminder-dst-fold");
  assert.match(gap.turns[0].prompt, /28 March 2027.*1:30am/);
  assert.match(fold.turns[0].prompt, /31 October 2027.*1:30am/);
  for (const item of historical.filter(item => /invalid|dst-gap|dst-fold/.test(item.id))) assert.deepEqual(item.allowedWrites, {});
  const duplicate = historical.find(item => item.id === "historical-reminder-duplicate-move-select");
  assert.equal(duplicate.turns[0].prompt, "Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
  assert.equal(duplicate.turns[1].prompt, "the second one");
  assert.deepEqual(duplicate.turns[0].allowedWrites, {});
  assert.match(historical.find(item => item.id === "historical-reminder-source-date-followup").turns[1].prompt, /originally due on 15 January 2027/);
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

test("the additive image journey requires one native private image receipt rather than a claimed tool success", () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const cases = createAgentEvalScenarios("2026-10-10");
    const image = cases.find(item => item.id === "image-generated-once");
    assert.ok(image, "The image workflow must be exercised by the full suite");
    assert.match(image.turns[0].prompt, /generate.*image/i);
    assert.deepEqual(image.turns[0].calls.map(call => call.name), ["core_images_generate", "core_images_generate"]);
    assert.deepEqual(image.turns[0].calls[0].arguments, image.turns[0].calls[1].arguments);
    assert.ok(image.rubric.includes("simulated"));
    assert.equal(image.check(seed, []), false);
    assert.equal(image.check(seed, [{ tool_name: "core_images_generate", status: "succeeded", result_json: JSON.stringify({ result: { operationId: "invented", imageAction: { kind: "generated", status: "complete", assets: [{ id: "invented", attachmentId: "invented" }] } } }) }]), false);
  } finally { seed.close(); }
});

test("private image write audits reject a Files folder even when no file was mirrored", () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const image = createAgentEvalScenarios(seed.baseDate).find(item => item.id === "image-generated-once");
    const before = snapshotEvalState(seed);
    seed.raw.prepare("INSERT INTO drive_folders(id,owner_id,name,path) VALUES('unexpected-image-folder',?,'Generated images','/Generated images')").run(seed.ownerId);
    assert.equal(auditEvalWrites(before, snapshotEvalState(seed), image).unauthorizedWrites, 1);
  } finally { seed.close(); }
});
