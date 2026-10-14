import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

const plugins = new Set(["me3.social-publishing", "me3.journal", "me3.mission-control"]);
const tables = ["social_packages", "social_variants", "social_suggestions", "social_publications", "social_posting_plans", "social_posting_plan_items"];
const snapshot = seed => tables.map(table => seed.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
const read = (sourceType = "journal", sourceId = "eval-journal") => ({ name: "core_social_source_read", arguments: { sourceType, sourceId } });
const draft = (sourceType = "journal", sourceId = "eval-journal") => ({ name: "core_social_draft_create", arguments: { sourceType, sourceId, ideaText: "A calmer launch", linkedinBody: "Make room for a calmer launch week.", xBody: "Choose a calmer launch.", instagramBody: "A calmer launch begins with one deliberate step." } });
async function turn(seed, id, prompt, calls, options = {}) {
  return createRuntimeAdapter("new").runTurn({ seed, ownerId: seed.ownerId, turnId: id, requestId: id,
    messages: [{ role: "user", content: prompt }], canonicalOwnerInputs: [{ turnId: id, requestId: id, messageText: prompt }],
    ownerTimezone: "Europe/Dublin", enabledPluginIds: plugins, services: createSeededEvalServices(seed), modelRoute: { model: "scripted-fixture" },
    fixtureCalls: calls, fixtureReply: "The saved results are ready for review; nothing was published.", ...options });
}

for (const [sourceType, sourceId] of [["journal", "eval-journal"], ["mission_task", "eval-task"], ["journal", "today"]]) {
  test(`new social tools preserve exact ${sourceType}/${sourceId} source and distinct unapproved platform drafts after reopen`, async context => {
    const seed = createSeededAgentEvalInstallation("2026-10-14");
    try {
      const id = sourceType === "journal" ? "eval-journal" : "eval-task";
      if (sourceId === "today") {
        context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-14T12:00:00Z") });
        seed.raw.prepare("UPDATE journal_entries SET entry_date='2026-10-14' WHERE id='eval-journal'").run();
      }
      const response = await turn(seed, `source-${sourceType}-${sourceId}`, "Use this exact private source to create LinkedIn, X and Instagram drafts for review.", [read(sourceType, sourceId), draft(sourceType, sourceId)]);
      assert.ok(response.toolCalls.every(call => call.status === "ok"));
      seed.reopen();
      const post = seed.raw.prepare("SELECT * FROM social_packages").get();
      assert.equal(post.source_type, sourceType);
      assert.equal(post.source_ref, `${sourceType}:${id}`);
      assert.equal(post.created_by, "agent");
      const source = JSON.parse(post.source_snapshot);
      assert.equal(source.id, id);
      if (sourceType === "journal") assert.equal(source.body, "I need a calmer launch week.");
      else { assert.equal(source.projectId, "eval-project"); assert.equal(source.projectName, "ME3 Launch"); }
      const versions = seed.raw.prepare("SELECT * FROM social_variants ORDER BY platform").all();
      assert.deepEqual(versions.map(row => row.platform), ["instagram", "linkedin", "x"]);
      assert.equal(new Set(versions.map(row => row.body_text)).size, 3);
      assert.ok(versions.every(row => row.approval_status === "draft" && row.approved_at === null));
      assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM social_publications").get().n, 0);
    } finally { seed.close(); }
  });
}

test("new social source guards refuse changed, missing, foreign and disabled sources without drafts", async () => {
  for (const failure of ["changed", "missing", "foreign", "disabled"]) {
    const seed = createSeededAgentEvalInstallation("2026-10-14");
    try {
      await turn(seed, `read-${failure}`, "Read my exact journal source.", [read()]);
      if (failure === "changed") seed.raw.prepare("UPDATE journal_entries SET body='A new owner revision', updated_at='2026-10-14T12:01:00Z' WHERE id='eval-journal'").run();
      if (failure === "missing") seed.raw.prepare("DELETE FROM journal_entries WHERE id='eval-journal'").run();
      if (failure === "foreign") seed.raw.prepare("UPDATE journal_entries SET user_id='other-owner' WHERE id='eval-journal'").run();
      const before = snapshot(seed);
      const response = await turn(seed, `draft-${failure}`, "Create the exact previously read source as drafts.", [draft()], failure === "disabled" ? { enabledPluginIds: new Set(["me3.social-publishing"]) } : {});
      seed.reopen();
      assert.ok(response.toolCalls.some(call => call.status === "error"), failure);
      assert.deepEqual(snapshot(seed), before, failure);
    } finally { seed.close(); }
  }
});

test("new social Suggestions remain grounded and source-less or invented excerpts never write", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  const text = "I need a calmer launch week.";
  const args = { sourceType: "journal", sourceId: "eval-journal", quoteText: text, quoteSourceExcerpt: text, shortPostText: "Plan a calmer launch.", shortPostSourceExcerpt: text, threadText: "1. Calm first.\n2. Launch deliberately.", threadSourceExcerpt: text, carouselOutlineText: "Slide 1: Calm\nSlide 2: A deliberate launch", carouselSourceExcerpt: text };
  try {
    const response = await turn(seed, "grounded-suggestions", "Create four grounded suggestions from this journal entry.", [read(), { name: "core_social_suggestions_create", arguments: args }]);
    assert.ok(response.toolCalls.every(call => call.status === "ok"));
    seed.reopen();
    const rows = seed.raw.prepare("SELECT * FROM social_suggestions ORDER BY suggestion_kind").all();
    assert.equal(rows.length, 4);
    assert.ok(rows.every(row => row.source_ref === "journal:eval-journal" && row.source_text === text && row.source_excerpt === text && row.status === "suggested" && row.selected_post_id === null));
    const before = snapshot(seed);
    for (const invalid of [{ ...args, sourceId: "missing-source" }, { ...args, quoteSourceExcerpt: "An invented private quotation" }, { ...args, sourceType: undefined, sourceId: undefined }]) {
      const result = await turn(seed, `bad-source-${crypto.randomUUID()}`, "Make suggestions only from the actual source.", [{ name: "core_social_suggestions_create", arguments: invalid }]);
      assert.ok(result.toolCalls.some(call => call.status === "error"));
      seed.reopen(); assert.deepEqual(snapshot(seed), before);
    }
  } finally { seed.close(); }
});

function planFixture(seed) {
  seed.raw.prepare("INSERT INTO social_accounts(id,user_id,site_id,platform,platform_account_id,display_name,status,scopes_json,metadata_json,access_token_ciphertext) VALUES('review-account',?,'eval-site','linkedin','synthetic-account','Synthetic LinkedIn','active','[]','{}','unusable-synthetic-token')").run(seed.ownerId);
  seed.raw.exec(`INSERT INTO social_posting_preferences(account_id,timezone,preferred_times_json,minimum_gap_minutes) VALUES('review-account','UTC','[{"day":"monday","localTime":"09:00"}]',0);
    INSERT INTO social_packages(id,site_id,post_slug,post_title_snapshot,source_hash,status,created_by,source_type,source_snapshot,source_text,idea_text) VALUES('review-post','eval-site','review-post','Reviewed source','hash','ready','user','journal','{}','Reviewed source','Draft');
    INSERT INTO social_variants(id,package_id,platform,target_account_id,format,body_text,asset_manifest_json,approval_status,approved_at,approved_by_user_id) VALUES('review-version','review-post','linkedin','review-account','post','Reviewed body','[]','approved','2026-10-14T10:00:00Z','eval-owner');`);
}

test("new posting plan is review-only and changed reviewed items cannot schedule after durable approval", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  try {
    planFixture(seed);
    const proposed = await turn(seed, "propose-plan", "Propose one approved LinkedIn post for review; do not schedule it.", [{ name: "core_social_posting_plan_create", arguments: { accountId: "review-account", versionIds: "review-version", windowStart: "2099-10-19T00:00:00Z", windowEnd: "2099-10-26T00:00:00Z", count: 1 } }]);
    assert.equal(proposed.toolCalls[0].status, "ok");
    const plan = seed.raw.prepare("SELECT * FROM social_posting_plans").get();
    assert.equal(plan.status, "suggested");
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM social_posting_plan_items").get().n, 1);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM social_publications").get().n, 0);
    const call = { name: "core_social_posting_plan_confirm", arguments: { planId: plan.id } };
    const pending = await turn(seed, "confirm-plan", "Schedule this exact reviewed LinkedIn plan after my durable approval.", [call], { intentFixtureVerdicts: [{ decision: "allow", selectedCandidateId: plan.id, authorizedCall: call }] });
    assert.equal(pending.status, "needs_approval");
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM social_publications").get().n, 0);
    seed.raw.prepare("UPDATE social_posting_plan_items SET scheduled_for='2099-10-21T11:00:00Z' WHERE plan_id=?").run(plan.id);
    const before = snapshot(seed);
    const resumed = await turn(seed, "confirm-plan", "Schedule this exact reviewed LinkedIn plan after my durable approval.", [], { approve: true });
    seed.reopen();
    assert.equal(resumed.status, "failed");
    assert.ok(resumed.toolCalls.some(call => call.name === "core_social_posting_plan_confirm" && call.status === "error"));
    assert.deepEqual(snapshot(seed), before);
  } finally { seed.close(); }
});
