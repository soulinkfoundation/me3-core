import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  FIXED_MODEL_EVALUATION_CANDIDATES,
  FIXED_MODEL_EVALUATION_TASKS,
  runFixedModelEvaluation,
  type ModelEvaluationCandidate,
  type ModelEvaluationCandidateConfig,
} from "@me3-core/plugin-agent-chat/model-evaluation";

const env = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env || {};
const liveEnabled = env.ME3_MODEL_EVAL_RUN === "1";
const minimumToolChoiceAccuracy = Number(
  env.ME3_MODEL_EVAL_MIN_TOOL_CHOICE_ACCURACY || 0,
);

describe.skipIf(!liveEnabled)("live fixed-task model evaluation", () => {
  it("writes one metadata-only report for the configured candidates", async () => {
    const selected = selectCandidates(env.ME3_MODEL_EVAL_CANDIDATES);
    const image = await readFile(
      new URL("../../web/public/me3-logo-dark.png", import.meta.url),
    );
    const base64 = bytesToBase64(image);
    const report = await runFixedModelEvaluation({
      candidates: selected.map(createLiveCandidate),
      visionImage: {
        name: "me3-logo-dark.png",
        mimeType: "image/png",
        base64,
        dataUrl: `data:image/png;base64,${base64}`,
      },
    });

    console.info(`ME3_MODEL_EVAL_RESULTS ${JSON.stringify(report)}`);
    expect(report.candidates).toHaveLength(selected.length);
    expect(report.candidates.every((candidate) => candidate.totals.tasks === 39)).toBe(true);
    if (minimumToolChoiceAccuracy > 0) {
      expect(
        report.candidates.every(
          (candidate) =>
            candidate.status !== "completed" ||
            (candidate.toolMetrics.toolChoiceAccuracy ?? 0) >=
              minimumToolChoiceAccuracy,
        ),
      ).toBe(true);
    }
    expect(FIXED_MODEL_EVALUATION_TASKS).toHaveLength(39);
  }, 600_000);
});

function selectCandidates(value: string | undefined): ModelEvaluationCandidateConfig[] {
  const requested = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!requested?.length) {
    return FIXED_MODEL_EVALUATION_CANDIDATES.filter(
      (candidate) => candidate.enabledByDefault,
    );
  }
  const byId = new Map(
    FIXED_MODEL_EVALUATION_CANDIDATES.map((candidate) => [candidate.id, candidate]),
  );
  return requested.map((id) => {
    const candidate = byId.get(id);
    if (!candidate) throw new Error(`Unknown model evaluation candidate: ${id}`);
    return candidate;
  });
}

function createLiveCandidate(
  config: ModelEvaluationCandidateConfig,
): ModelEvaluationCandidate {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() || "";
  const gatewayId = env.CLOUDFLARE_AI_GATEWAY_ID?.trim() || "default";
  const configured = Boolean(accountId && apiToken);
  const model = config.providerId === "workers-ai"
    ? config.model
    : `${config.providerId}/${config.model}`;
  return {
    ...config,
    route: {
      providerId: "workers-ai",
      model,
      backupModel: null,
      apiKey: null,
      ai: configured
        ? { run: (selectedModel, input) => runCloudflareAiRest(accountId, apiToken, gatewayId, selectedModel, input) }
        : null,
      aiGateway: null,
      configured,
    },
  };
}

async function runCloudflareAiRest(
  accountId: string,
  apiToken: string,
  gatewayId: string,
  model: string,
  input: unknown,
): Promise<unknown> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "cf-aig-gateway-id": gatewayId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input }),
    },
  );
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || payload?.success === false || payload?.error) {
    throw new Error(`Cloudflare AI request failed (${response.status})`);
  }
  const run = payload?.result ?? payload;
  return run && typeof run === "object" && ("gatewayMetadata" in run || "state" in run) && "result" in run
    ? run.result
    : run;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
