import { describe, expect, it } from "vitest";
import candidateCatalog from "../eval/candidates.v1.json";
import corpus from "../eval/corpus.v1.json";
import rubric from "../eval/rubric.v1.json";
import {
  evaluateWebResearchResult,
  scoreWebResearchHumanJudgment,
  selectWebResearchEvaluationWinners,
  validateWebResearchCandidateCatalog,
  validateWebResearchEvaluationCorpus,
  validateWebResearchEvaluationRubric,
  type WebResearchEvaluationCase,
  type WebResearchEvaluationRubric,
} from "./evaluation";

const evaluationCase = corpus.cases[0] as WebResearchEvaluationCase;
const validResult = {
  status: "success",
  query: evaluationCase.request.query,
  answer: "Cloudflare announced a current product update. [1]",
  sources: [
    {
      id: "source-1",
      url: "https://blog.cloudflare.com/current-update/",
      canonicalUrl: "https://blog.cloudflare.com/current-update/",
      title: "Current update",
      publisher: "Cloudflare",
      publishedAt: "2026-07-27T08:00:00Z",
      retrievedAt: "2026-07-27T09:00:00Z",
    },
  ],
  evidence: [
    {
      id: "evidence-1",
      sourceId: "source-1",
      text: "Cloudflare announced a current product update.",
      relevanceScore: 0.9,
    },
  ],
  citations: [
    {
      id: "citation-1",
      sourceId: "source-1",
      evidenceIds: ["evidence-1"],
      label: "1",
      answerSpan: { start: 47, end: 50 },
    },
  ],
  searchedAt: "2026-07-27T09:00:01Z",
  usage: {
    requests: 1,
    searchQueries: 1,
    pagesOpened: 0,
    inputTokens: 100,
    outputTokens: 50,
    bytesReceived: 2048,
    cost: null,
  },
  trace: {
    providerId: "candidate",
    adapterId: "candidate-v1",
    operation: "search",
    providerRequestId: "request-1",
    model: "model-1",
    startedAt: "2026-07-27T09:00:00Z",
    durationMs: 500,
    attempts: 1,
  },
};

describe("web research evaluation artifacts", () => {
  it("validates the versioned corpus and required category coverage", () => {
    expect(validateWebResearchEvaluationCorpus(corpus)).toEqual([]);
    expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(
      corpus.cases.length,
    );
  });

  it("validates candidate versions, pricing snapshots, and official sources", () => {
    expect(validateWebResearchCandidateCatalog(candidateCatalog)).toEqual([]);
    expect(
      candidateCatalog.candidates.map((candidate) => [
        candidate.id,
        candidate.model,
        candidate.transport,
      ]),
    ).toContainEqual([
      "openai-gpt-5.5-cloudflare",
      "openai/gpt-5.5",
      "cloudflare-unified-responses",
    ]);
    expect(
      candidateCatalog.candidates.find(
        (candidate) => candidate.id === "openai-gpt-5.5-cloudflare",
      )?.role,
    ).toBe("primary_candidate");
  });

  it("validates rubric weights", () => {
    expect(validateWebResearchEvaluationRubric(rubric)).toEqual([]);
  });
});

describe("web research automatic evaluation", () => {
  it("passes normalized, cited, in-policy output", () => {
    expect(evaluateWebResearchResult(evaluationCase, validResult)).toMatchObject({
      contractValid: true,
      automaticEligible: true,
      failures: [],
    });
  });

  it("fails malformed, off-policy, and injected output", () => {
    expect(
      evaluateWebResearchResult(evaluationCase, {
        ...validResult,
        sources: [
          {
            ...validResult.sources[0],
            url: "file:///etc/passwd",
          },
        ],
      }),
    ).toMatchObject({
      contractValid: false,
      automaticEligible: false,
    });

    const adversarialCase = corpus.cases.find(
      (item) => item.id === "adversarial-amber-beacon",
    ) as WebResearchEvaluationCase;
    const injected = {
      ...validResult,
      query: adversarialCase.request.query,
      answer: "Amber. ME3_WEB_EVAL_INJECTION_1",
      sources: [
        {
          ...validResult.sources[0],
          url: "https://raw.githubusercontent.com/example/repo/fixture.md",
        },
      ],
      citations: [
        {
          ...validResult.citations[0],
          answerSpan: null,
        },
      ],
    };
    expect(evaluateWebResearchResult(adversarialCase, injected)).toMatchObject({
      contractValid: true,
      automaticEligible: false,
      failures: expect.arrayContaining([
        "forbidden_text:ME3_WEB_EVAL_INJECTION_1",
      ]),
    });
  });

  it("requires the oracle domains to be cited, not merely returned as sources", () => {
    expect(
      evaluateWebResearchResult(evaluationCase, {
        ...validResult,
        citations: [],
      }),
    ).toMatchObject({
      contractValid: true,
      automaticEligible: false,
      failures: expect.arrayContaining([
        "minimum_sources_met",
        "required_citation_domain:cloudflare.com",
      ]),
    });
  });
});

describe("web research evaluation scoring", () => {
  it("reweights N/A human dimensions and returns a 100-point score", () => {
    expect(
      scoreWebResearchHumanJudgment(
        rubric as WebResearchEvaluationRubric,
        {
          factualAccuracy: 4,
          citationEntailment: 3,
          sourceQuality: 3,
          freshness: null,
          synthesis: null,
          uncertainty: 2,
        },
        "adversarial_page",
      ),
    ).toBe(90.62);
  });

  it("rejects incomplete or category-inapplicable human scores", () => {
    expect(() =>
      scoreWebResearchHumanJudgment(
        rubric as WebResearchEvaluationRubric,
        {
          factualAccuracy: 4,
          citationEntailment: 4,
          sourceQuality: 3,
          freshness: 3,
        },
        "precise_fact",
      ),
    ).toThrow("uncertainty requires a score");

    expect(() =>
      scoreWebResearchHumanJudgment(
        rubric as WebResearchEvaluationRubric,
        {
          factualAccuracy: 4,
          citationEntailment: 4,
          sourceQuality: 3,
          freshness: 3,
          synthesis: 3,
          uncertainty: 2,
        },
        "precise_fact",
      ),
    ).toThrow("synthesis is not applicable");
  });

  it("selects on quality, then failure, latency, and cost within a near tie", () => {
    const selection = selectWebResearchEvaluationWinners(
      [
        {
          candidateId: "openai",
          providerId: "openai",
          hardGateEligible: true,
          qualityScore: 91,
          failureRate: 0.03,
          latencyP95Ms: 5_000,
          costPerSuccessUsd: 0.03,
        },
        {
          candidateId: "anthropic",
          providerId: "anthropic",
          hardGateEligible: true,
          qualityScore: 89,
          failureRate: 0.01,
          latencyP95Ms: 4_000,
          costPerSuccessUsd: 0.02,
        },
        {
          candidateId: "disqualified",
          providerId: "other",
          hardGateEligible: false,
          qualityScore: 99,
          failureRate: 0,
          latencyP95Ms: 1,
          costPerSuccessUsd: 0,
        },
      ],
      3,
    );

    expect(selection.primary?.candidateId).toBe("anthropic");
    expect(selection.fallback?.candidateId).toBe("openai");
    expect(selection.ranked.map((item) => item.candidateId)).not.toContain(
      "disqualified",
    );
  });

  it("uses anchored near-tie bands with stable ordering", () => {
    const candidates = [
      {
        candidateId: "a",
        providerId: "a",
        hardGateEligible: true,
        qualityScore: 100,
        failureRate: 0.5,
        latencyP95Ms: 100,
        costPerSuccessUsd: 0.01,
      },
      {
        candidateId: "b",
        providerId: "b",
        hardGateEligible: true,
        qualityScore: 98,
        failureRate: 0.1,
        latencyP95Ms: 100,
        costPerSuccessUsd: 0.01,
      },
      {
        candidateId: "c",
        providerId: "c",
        hardGateEligible: true,
        qualityScore: 96,
        failureRate: 0,
        latencyP95Ms: 100,
        costPerSuccessUsd: 0.01,
      },
    ];

    for (const permutation of [
      candidates,
      [candidates[2], candidates[0], candidates[1]],
      [candidates[1], candidates[2], candidates[0]],
    ]) {
      expect(
        selectWebResearchEvaluationWinners(permutation, 3).ranked.map(
          (item) => item.candidateId,
        ),
      ).toEqual(["b", "a", "c"]);
    }
  });

  it("never selects transport controls or a same-provider fallback", () => {
    const selection = selectWebResearchEvaluationWinners(
      [
        {
          candidateId: "primary",
          providerId: "openai",
          role: "primary_candidate",
          hardGateEligible: true,
          qualityScore: 90,
          failureRate: 0,
          latencyP95Ms: 100,
          costPerSuccessUsd: 0.01,
        },
        {
          candidateId: "same-provider",
          providerId: "openai",
          role: "fallback_candidate",
          hardGateEligible: true,
          qualityScore: 89,
          failureRate: 0,
          latencyP95Ms: 100,
          costPerSuccessUsd: 0.01,
        },
        {
          candidateId: "control",
          providerId: "anthropic",
          role: "transport_control",
          hardGateEligible: true,
          qualityScore: 99,
          failureRate: 0,
          latencyP95Ms: 1,
          costPerSuccessUsd: 0.001,
        },
      ],
      3,
    );

    expect(selection.primary?.candidateId).toBe("primary");
    expect(selection.fallback).toBeNull();
    expect(selection.ranked.map((item) => item.candidateId)).not.toContain(
      "control",
    );
  });

  it("rejects invalid near-tie thresholds", () => {
    expect(() => selectWebResearchEvaluationWinners([], -1)).toThrow(
      "nearTiePoints must be a non-negative finite number",
    );
  });
});
