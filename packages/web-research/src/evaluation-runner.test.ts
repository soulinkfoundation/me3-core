import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import candidateCatalog from "../eval/candidates.v1.json";
import corpus from "../eval/corpus.v1.json";
import rubric from "../eval/rubric.v1.json";
// @ts-expect-error The executable runner intentionally has no declaration file.
const runner = await import("../../../scripts/evaluate-web-research.mjs");
const {
  aggregateQualityScore,
  applyResultLimit,
  attachCloudflareGatewayMetadata,
  automaticGates,
  buildBlindReviewArtifacts,
  buildNormalizedResultCandidate,
  estimateCost,
  normalizeAnthropicObservation,
  normalizeOpenAiObservation,
  openAiCandidateHeaders,
  parseProviderJson,
  resolveCandidateEndpoint,
  scoreManualHardGates,
  scoreEvaluationRun,
  selectionReadiness,
  summarizeObservations,
  trimAnswerAndRebaseCitations,
  validateFixtureBaseUrl,
} = runner;

type TestBlindReviewEntry = Record<string, unknown> & {
  answer: string;
  applicableDimensions: Array<{ id: string; maximum: number }>;
  manualHardGates: Array<Record<string, unknown>>;
};

describe("web research evaluation provider normalization", () => {
  it("uses Cloudflare credentials and the named gateway without payload logs", () => {
    const candidate = candidateCatalog.candidates.find((item) => item.id === "openai-gpt-5.5-cloudflare")!;
    const environment = {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "cloudflare-test-token",
      CLOUDFLARE_AI_GATEWAY_ID: "gateway-id",
    };
    expect(resolveCandidateEndpoint(candidate, environment)).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-id/ai/v1/responses",
    );
    expect(openAiCandidateHeaders(candidate, 12_345, environment)).toMatchObject({
      Authorization: "Bearer cloudflare-test-token",
      "cf-aig-gateway-id": "gateway-id",
      "cf-aig-collect-log-payload": "false",
    });
  });

  it("rejects a catalog endpoint outside the Cloudflare API", () => {
    const candidate = candidateCatalog.candidates.find((item) => item.id === "openai-gpt-5.5-cloudflare")!;
    expect(() => resolveCandidateEndpoint(
      { ...candidate, endpoint: "https://malicious.example/responses" },
      { CLOUDFLARE_ACCOUNT_ID: "account-id" },
    )).toThrow("unsafe Cloudflare endpoint");
  });

  it("captures Cloudflare's non-secret gateway log correlation ID", () => {
    const candidate = candidateCatalog.candidates.find(
      (item) => item.id === "openai-gpt-5.5-cloudflare",
    )!;
    const observation = {
      providerMetadata: {
        requestIds: ["response-id"],
        resolvedModel: "gpt-5.5",
      },
    };

    expect(
      attachCloudflareGatewayMetadata(
        candidate,
        new Response(null, {
          headers: { "cf-aig-log-id": "gateway-log-id" },
        }),
        observation,
      ),
    ).toEqual({
      providerMetadata: {
        requestIds: ["response-id"],
        resolvedModel: "gpt-5.5",
        gatewayLogId: "gateway-log-id",
      },
    });
  });

  it("retains safe HTTP diagnostics without persisting provider error text", async () => {
    try {
      await parseProviderJson(
        new Response(
          JSON.stringify({
            error: {
              code: "invalid_gateway_token",
              message: "sensitive upstream detail",
            },
          }),
          {
            status: 401,
            headers: { "cf-aig-log-id": "gateway-error-log-id" },
          },
        ),
        "OpenAI",
      );
      throw new Error("expected provider rejection");
    } catch (error) {
      expect((error as Error).message).toBe("OpenAI:provider_rejected:401");
      expect(
        (
          error as Error & {
            providerMetadata: Record<string, unknown>;
          }
        ).providerMetadata,
      ).toEqual({
        httpStatus: 401,
        gatewayLogId: "gateway-error-log-id",
        providerErrorCode: "invalid_gateway_token",
      });
      expect(JSON.stringify(error)).not.toContain("sensitive upstream detail");
    }
  });

  it("normalizes OpenAI citations and bills one search action", () => {
    const result = normalizeOpenAiObservation({
      id: "resp-1",
      model: "gpt-5.5-2026-07-01",
      status: "completed",
      system_fingerprint: "fp-1",
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            queries: ["first query", "second query"],
            sources: [
              {
                url: "https://example.com/source",
                title: "Source",
              },
            ],
          },
        },
        {
          type: "message",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "  Answer [1]  ",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://example.com/source",
                  title: "Source",
                  start_index: 9,
                  end_index: 12,
                },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    expect(result).toMatchObject({
      answer: "Answer [1]",
      usage: {
        requests: 1,
        searchQueries: 1,
        pagesOpened: 0,
        inputTokens: 100,
        outputTokens: 20,
      },
      providerMetadata: {
        requestIds: ["resp-1"],
        resolvedModel: "gpt-5.5-2026-07-01",
        systemFingerprint: "fp-1",
      },
    });
    expect(result.sources).toHaveLength(1);
    expect(result.citations).toEqual([
      expect.objectContaining({ start: 7, end: 10 }),
    ]);
  });

  it("rejects incomplete OpenAI output while preserving reported usage", () => {
    try {
      normalizeOpenAiObservation({
        id: "resp-incomplete",
        model: "gpt-5.5",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: { input_tokens: 80, output_tokens: 12 },
      });
      throw new Error("expected incomplete output to fail");
    } catch (error) {
      expect((error as Error).message).toContain("OpenAI:incomplete");
      expect((error as Error & { usage: { inputTokens: number } }).usage).toMatchObject({
        inputTokens: 80,
        outputTokens: 12,
      });
      expect(
        (
          error as Error & {
            providerMetadata: { incompleteReason: string; responseStatus: string };
          }
        ).providerMetadata,
      ).toMatchObject({
        incompleteReason: "max_output_tokens",
        responseStatus: "incomplete",
      });
    }
  });

  it("accepts a completed OpenAI response with an in-progress search item", () => {
    const result = normalizeOpenAiObservation({
      id: "resp-searching-item",
      model: "gpt-5.5-2026-04-23",
      status: "completed",
      output: [
        {
          type: "web_search_call",
          status: "searching",
          action: {
            type: "search",
            sources: [
              {
                url: "https://example.com/source",
                title: "Source",
              },
            ],
          },
        },
        {
          type: "message",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "Answer",
              annotations: [],
            },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    expect(result.answer).toBe("Answer");
    expect(result.usage.searchQueries).toBe(1);
  });

  it("rejects an incomplete OpenAI message even when the response completed", () => {
    expect(() =>
      normalizeOpenAiObservation({
        id: "resp-incomplete-message",
        model: "gpt-5.5",
        status: "completed",
        output: [
          {
            type: "message",
            status: "in_progress",
            content: [],
          },
        ],
        usage: { input_tokens: 80, output_tokens: 12 },
      }),
    ).toThrow("OpenAI:incomplete:message");
  });

  it("aggregates Anthropic pause-turn responses, citations, and usage", () => {
    const result = normalizeAnthropicObservation([
      {
        id: "msg-1",
        model: "claude-sonnet-4-6",
        stop_reason: "pause_turn",
        content: [
          {
            type: "web_search_tool_result",
            content: [
              {
                type: "web_search_result",
                url: "https://example.com/source",
                title: "Source",
              },
            ],
          },
          { type: "text", text: "Working." },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          server_tool_use: { web_search_requests: 1 },
        },
      },
      {
        id: "msg-2",
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: "Final answer.",
            citations: [
              {
                type: "web_search_result_location",
                url: "https://example.com/source",
                title: "Source",
                cited_text: "Evidence",
              },
            ],
          },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 3,
          server_tool_use: { web_search_requests: 0 },
        },
      },
    ]);

    expect(result).toMatchObject({
      answer: "Working.\nFinal answer.",
      usage: {
        requests: 2,
        searchQueries: 1,
        inputTokens: 30,
        outputTokens: 5,
      },
      providerMetadata: {
        requestIds: ["msg-1", "msg-2"],
        resolvedModel: "claude-sonnet-4-6",
      },
    });
    expect(result.sources).toHaveLength(1);
    expect(result.citations).toHaveLength(1);
  });

  it("rebases citation spans after trimming provider whitespace", () => {
    expect(
      trimAnswerAndRebaseCitations("  Answer  ", [
        { url: "https://example.com", start: 0, end: 10 },
      ]),
    ).toEqual({
      answer: "Answer",
      citations: [
        { url: "https://example.com", start: 0, end: 6 },
      ],
    });
  });

  it("bounds normalized sources while preserving every cited source", () => {
    const normalized = {
      sources: [
        { url: "https://example.com/uncited", title: "Uncited" },
        { url: "https://example.com/cited", title: "Cited" },
      ],
      citations: [{ url: "https://example.com/cited" }],
    };
    expect(applyResultLimit(normalized, 1).sources).toEqual([
      { url: "https://example.com/cited", title: "Cited" },
    ]);
    expect(
      applyResultLimit(
        {
          ...normalized,
          citations: normalized.sources.map((source) => ({
            url: source.url,
          })),
        },
        1,
      ).sources,
    ).toHaveLength(2);
  });
});

describe("web research evaluation runner policy", () => {
  it("scores operational failures as zero in candidate quality", () => {
    expect(aggregateQualityScore([100], 2)).toBe(50);
    expect(aggregateQualityScore([], 2)).toBeNull();
  });

  it("never treats missing billed token usage as a zero-cost estimate", () => {
    const candidate = {
      pricing: {
        searchCallPer1000Usd: 10,
        inputPerMillionUsd: 5,
        outputPerMillionUsd: 30,
        unifiedBillingCreditFeePercent: 5,
      },
    };
    expect(
      estimateCost(candidate, {
        searchQueries: 1,
        inputTokens: null,
        outputTokens: 20,
      }),
    ).toBeNull();
    expect(
      estimateCost(candidate, {
        searchQueries: 1,
        inputTokens: 100,
        outputTokens: 20,
      }),
    ).toBeGreaterThan(0);
  });

  it("rejects subset and transport-control plans for formal selection", () => {
    const productionCandidates = [
      {
        id: "primary",
        providerId: "openai",
        role: "primary_candidate",
      },
      {
        id: "fallback",
        providerId: "anthropic",
        role: "fallback_candidate",
      },
    ];
    const allCaseIds = corpus.cases.map((evaluationCase) => evaluationCase.id);

    expect(
      selectionReadiness(productionCandidates, [allCaseIds[0]], []),
    ).toMatchObject({
      eligible: false,
      blockers: ["corpus_incomplete"],
    });
    expect(
      selectionReadiness(
        productionCandidates.map((candidate) => ({
          ...candidate,
          role: "transport_control",
        })),
        allCaseIds,
        [],
      ),
    ).toMatchObject({
      eligible: false,
      blockers: ["transport_controls_are_exploratory_only"],
    });
    expect(selectionReadiness(productionCandidates, allCaseIds, [])).toEqual({
      eligible: true,
      blockers: [],
    });
  });

  it("executes normalized-contract and citation-reference hard gates", () => {
    const evaluationCase = {
      request: {
        query: "What is the answer?",
        resultLimit: 1,
        domainPolicy: { allowedDomains: ["example.com"], blockedDomains: [] },
      },
      oracle: {
        minimumDistinctSources: 1,
        requiredCitationDomains: ["example.com"],
        requiredText: [],
        forbiddenText: [],
      },
    };
    const observationInput = {
      answer: "Answer",
      sources: [
        { url: "https://example.com/one", title: "One" },
        { url: "https://example.com/two", title: "Two" },
      ],
      retrievedSources: [
        { url: "https://example.com/one", title: "One" },
        { url: "https://example.com/two", title: "Two" },
      ],
      citations: [
        {
          url: "https://example.com/missing",
          title: "Missing",
          start: 0,
          end: 6,
        },
      ],
      usage: {
        requests: 1,
        searchQueries: 1,
        pagesOpened: 0,
        inputTokens: 10,
        outputTokens: 5,
      },
      providerMetadata: {
        requestIds: ["request-1"],
        resolvedModel: "model",
        systemFingerprint: null,
      },
    };
    const observation = {
      ...observationInput,
      normalizedResultCandidate: buildNormalizedResultCandidate(
        {
          providerId: "openai",
          transport: "cloudflare-unified-responses",
        },
        evaluationCase,
        observationInput,
        "2026-07-27T12:00:00.000Z",
        100,
      ),
    };

    expect(automaticGates(evaluationCase, observation)).toEqual(
      expect.arrayContaining([
        "normalized_contract_valid",
        "citation_references_valid",
      ]),
    );

    const validObservationInput = {
      ...observationInput,
      sources: [{ url: "https://example.com/one", title: "One" }],
      retrievedSources: [
        { url: "https://example.com/one", title: "One" },
      ],
      citations: [
        {
          url: "https://example.com/one",
          title: "One",
          start: 0,
          end: 6,
        },
      ],
    };
    const validObservation = {
      ...validObservationInput,
      normalizedResultCandidate: buildNormalizedResultCandidate(
        {
          providerId: "openai",
          transport: "cloudflare-unified-responses",
        },
        evaluationCase,
        validObservationInput,
        "2026-07-27T12:00:00.000Z",
        100,
      ),
    };
    expect(automaticGates(evaluationCase, validObservation)).toEqual([]);

    expect(
      automaticGates(evaluationCase, {
        ...validObservation,
        retrievedSources: [
          ...validObservation.retrievedSources,
          { url: "https://off-policy.test/source", title: "Off policy" },
        ],
      }),
    ).toContain("domain_policy_obeyed");

    expect(
      automaticGates(evaluationCase, {
        ...validObservation,
        citations: [
          {
            url: "https://example.com/other",
            title: "Other",
            start: 0,
            end: 6,
          },
        ],
      }),
    ).toContain("normalized_contract_valid");
  });

  it("uses one provider-neutral citation shape in blind packets", () => {
    const evaluationCase = corpus.cases.find(
      (candidate) => candidate.category === "precise_fact",
    )!;
    const observations = ["openai", "anthropic"].map((candidateId) => ({
      candidateId,
      caseId: evaluationCase.id,
      category: evaluationCase.category,
      repeat: 0,
      status: "success",
      hardGateEligible: true,
      answer: "Answer",
      sources: [{ url: "https://example.com/source", title: "Source" }],
      citations: [
        {
          url: "https://example.com/source",
          title: "Source",
          start: 0,
          end: 6,
          ...(candidateId === "anthropic" ? { citedText: "provider leak" } : {}),
        },
      ],
    }));

    const artifacts = buildBlindReviewArtifacts(
      observations,
      [evaluationCase],
      "run",
      1,
    );
    expect(artifacts.packet.entries).toHaveLength(2);
    for (const entry of artifacts.packet.entries) {
      expect(entry.citations).toEqual([
        {
          url: "https://example.com/source",
          claimExcerpt: "Answer",
        },
      ]);
      expect(entry).not.toHaveProperty("candidateId");
    }
    for (const mapping of artifacts.map.entries) {
      expect(mapping.observationSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("binds scored review content to the exact stored observations", async () => {
    const evaluationCase = corpus.cases.find(
      (candidate) => candidate.id === "fact-workers-cpu-limit",
    )!;
    const candidates = candidateCatalog.candidates.filter((candidate) =>
      [
        "openai-gpt-5.5-cloudflare",
        "anthropic-sonnet-4.6-cloudflare",
      ].includes(candidate.id),
    );
    const observations = candidates.map((candidate, index) => {
      const normalized = {
        answer: `Candidate ${index + 1} answer`,
        sources: [
          {
            url: "https://developers.cloudflare.com/workers/platform/limits/",
            title: "Workers limits",
          },
        ],
        citations: [
          {
            url: "https://developers.cloudflare.com/workers/platform/limits/",
            title: "Workers limits",
            start: 0,
            end: 9,
          },
        ],
        usage: {
          requests: 1,
          searchQueries: 1,
          pagesOpened: 0,
          inputTokens: 100,
          outputTokens: 20,
        },
        providerMetadata: {
          requestIds: [`request-${index + 1}`],
          resolvedModel: candidate.model,
          systemFingerprint: null,
        },
      };
      const normalizedResultCandidate = buildNormalizedResultCandidate(
        candidate,
        evaluationCase,
        normalized,
        "2026-07-27T12:00:00.000Z",
        100 + index,
      );
      const gateInput = { ...normalized, normalizedResultCandidate };
      const hardGateFailures = automaticGates(evaluationCase, gateInput);
      return {
        schemaVersion: "me3-web-research-observation-v1",
        candidateId: candidate.id,
        caseId: evaluationCase.id,
        category: evaluationCase.category,
        repeat: 0,
        status: "success",
        hardGateEligible: hardGateFailures.length === 0,
        hardGateFailures,
        latencyMs: 100 + index,
        usage: normalized.usage,
        estimatedCostUsd: 0.01,
        costSource: "estimated",
        answer: normalized.answer,
        answerSha256: createHash("sha256")
          .update(normalized.answer)
          .digest("hex"),
        sources: normalized.sources,
        retrievedSources: normalized.sources,
        citations: normalized.citations,
        providerMetadata: normalized.providerMetadata,
        normalizedResultCandidate,
      };
    });
    expect(observations.every((observation) => observation.hardGateEligible)).toBe(
      true,
    );
    const runId = "score-binding-test";
    const artifacts = buildBlindReviewArtifacts(
      observations,
      [evaluationCase],
      runId,
      1,
    );
    const completedPacket = {
      ...artifacts.packet,
      entries: (artifacts.packet.entries as TestBlindReviewEntry[]).map((entry) => ({
        ...entry,
        scores: Object.fromEntries(
          entry.applicableDimensions.map((dimension) => [
            dimension.id,
            dimension.maximum,
          ]),
        ),
        manualHardGates: entry.manualHardGates.map((gate) => ({
          ...gate,
          passed: true,
        })),
      })),
    };
    const runDirectory = await mkdtemp(
      path.join(tmpdir(), "me3-web-research-score-"),
    );
    const writeJson = (name: string, value: unknown) =>
      writeFile(
        path.join(runDirectory, name),
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
      );
    const manifest = {
      schemaVersion: "me3-web-research-eval-manifest-v1",
      runId,
      completedAt: "2026-07-27T12:01:00.000Z",
      corpusVersion: corpus.version,
      candidateVersion: candidateCatalog.version,
      rubricVersion: rubric.version,
      candidateIds: candidates.map((candidate) => candidate.id),
      caseIds: [evaluationCase.id],
      skippedCaseIds: [],
      repeat: 1,
      coverageComplete: false,
    };
    try {
      await Promise.all([
        writeJson("manifest.json", manifest),
        writeJson(
          "summary.json",
          summarizeObservations(
            observations,
            candidates,
            false,
            runId,
          ),
        ),
        writeJson("blind-review-packet.json", completedPacket),
        writeJson("blind-review-map.json", artifacts.map),
        writeFile(
          path.join(runDirectory, "observations.ndjson"),
          `${observations.map((observation) => JSON.stringify(observation)).join("\n")}\n`,
          "utf8",
        ),
      ]);

      await scoreEvaluationRun({ run: runDirectory });
      const scored = JSON.parse(
        await readFile(
          path.join(runDirectory, "scored-summary.json"),
          "utf8",
        ),
      );
      expect(scored).toMatchObject({
        selectionEligible: false,
        primaryCandidateId: null,
        fallbackCandidateId: null,
        rankedCandidateIds: [
          "openai-gpt-5.5-cloudflare",
          "anthropic-sonnet-4.6-cloudflare",
        ],
      });

      await writeJson("blind-review-packet.json", {
        ...completedPacket,
        entries: completedPacket.entries.map(
          (entry: TestBlindReviewEntry, index: number) =>
            index === 0 ? { ...entry, candidateId: "identity-leak" } : entry,
        ),
      });
      await expect(
        scoreEvaluationRun({ run: runDirectory }),
      ).rejects.toThrow("unsupported field candidateId");

      await writeJson("blind-review-packet.json", {
        ...completedPacket,
        entries: completedPacket.entries.map(
          (entry: TestBlindReviewEntry, index: number) =>
            index === 0 ? { ...entry, answer: "tampered answer" } : entry,
        ),
      });
      await expect(
        scoreEvaluationRun({ run: runDirectory }),
      ).rejects.toThrow("immutable content changed");

      await Promise.all([
        writeJson("blind-review-packet.json", completedPacket),
        writeJson("manifest.json", { ...manifest, repeat: 11 }),
      ]);
      await expect(
        scoreEvaluationRun({ run: runDirectory }),
      ).rejects.toThrow("invalid candidate, case, or repeat coverage");
    } finally {
      await rm(runDirectory, { recursive: true, force: true });
    }
  });

  it("does not disqualify a candidate solely for an operational error", () => {
    const summary = summarizeObservations(
      [
        {
          candidateId: "candidate",
          status: "success",
          hardGateEligible: true,
          hardGateFailures: [],
          latencyMs: 100,
          estimatedCostUsd: 0.01,
        },
        {
          candidateId: "candidate",
          status: "error",
          hardGateEligible: false,
          hardGateFailures: ["timeout"],
          latencyMs: 200,
          estimatedCostUsd: null,
        },
      ],
      [
        {
          id: "candidate",
          providerId: "provider",
          model: "model",
          transport: "transport",
        },
      ],
      true,
      "run",
    );

    expect(summary.candidates[0]).toMatchObject({
      hardGateEligible: true,
      successRate: 0.5,
      failureRate: 0.5,
      failureClasses: { timeout: 1 },
    });
  });

  it("requires manual adversarial authority gates", () => {
    expect(
      scoreManualHardGates(
        [
          {
            id: "retrieved_content_grants_no_authority",
            passed: false,
          },
        ],
        "adversarial_page",
        "review-1",
      ),
    ).toEqual(["retrieved_content_grants_no_authority"]);
    expect(scoreManualHardGates([], "precise_fact", "review-2")).toEqual([]);
  });

  it("accepts only commit-pinned raw GitHub fixture directories", () => {
    expect(() =>
      validateFixtureBaseUrl(
        "https://raw.githubusercontent.com/example/repo/0123456789abcdef0123456789abcdef01234567/path",
      ),
    ).not.toThrow();
    expect(() =>
      validateFixtureBaseUrl(
        "https://raw.githubusercontent.com/example/repo/main/path",
      ),
    ).toThrow("pinned to a full commit SHA");
  });
});
