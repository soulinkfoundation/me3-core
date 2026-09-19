import type {
  AgentChatModelAttemptTrace,
  AgentSandboxDispatchResponse,
} from "./index";
import {
  parseAgentModelUsage,
  type AgentModelUsage,
} from "./tool-runtime";

export type AgentChatTextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentChatImageInput = {
  name: string;
  mimeType: string;
  base64: string;
  dataUrl: string;
};

export type AgentChatAiGatewayRuntimeConfig = {
  accountId: string | null;
  gatewayId: string | null;
  apiToken: string | null;
  routeWorkersAi: boolean;
  routeExternalProviders: boolean;
};

export type AgentChatAiGatewayRequestPolicy = {
  requestTimeoutMs: number;
  maxAttempts: 1 | 2 | 3 | 4 | 5;
};

export type AgentChatAiRoute = {
  providerId: "workers-ai" | "openai" | "anthropic";
  model: string;
  backupModel: string | null;
  apiKey: string | null;
  ai: {
    aiGatewayLogId?: string | null;
    run(model: string, input: unknown, options?: unknown): Promise<unknown>;
  } | null;
  aiGateway: AgentChatAiGatewayRuntimeConfig | null;
  aiGatewayMetadata?: Record<string, string | number | boolean>;
  aiGatewayRequestPolicy?: AgentChatAiGatewayRequestPolicy | null;
  jevRouterMode?: "off" | "shadow" | "active";
  recordUsage?: (input: {
    model: string;
    usage: AgentModelUsage;
  }) => void | Promise<void>;
  configured: boolean;
};

export function workersAiGatewayRunOptions(
  route: AgentChatAiRoute,
): Record<string, unknown> | undefined {
  if (!route.aiGateway?.routeWorkersAi || !route.aiGateway.gatewayId) {
    return undefined;
  }
  return {
    gateway: {
      id: route.aiGateway.gatewayId,
      ...(route.aiGatewayMetadata
        ? { metadata: route.aiGatewayMetadata }
        : {}),
      ...(route.aiGatewayRequestPolicy
        ? {
            requestTimeoutMs: route.aiGatewayRequestPolicy.requestTimeoutMs,
            retries: {
              maxAttempts: route.aiGatewayRequestPolicy.maxAttempts,
            },
          }
        : {}),
    },
  };
}

export function openAiCompatibleReasoningEffort(
  model: string,
): "none" | null {
  const normalized = model.trim().toLowerCase().replace(/^@cf\//, "");
  return normalized === "openai/gpt-5.4-mini" ||
    normalized === "openai/gpt-5.4-nano" ||
    normalized === "gpt-5.4-mini" ||
    normalized === "gpt-5.4-nano"
    ? "none"
    : null;
}

export async function runModelTurn(
  route: AgentChatAiRoute,
  messages: AgentChatTextMessage[],
  turnId: string,
  images: AgentChatImageInput[] = [],
): Promise<AgentSandboxDispatchResponse> {
  const attempts =
    route.providerId === "workers-ai" &&
    route.backupModel &&
    route.backupModel !== route.model
      ? [route.model, route.backupModel]
      : [route.model];
  let lastError: unknown = null;
  const modelAttempts: AgentChatModelAttemptTrace[] = [];

  for (const model of attempts) {
    const attemptStartedAt = performance.now();
    const gatewayLogIdBefore = route.ai?.aiGatewayLogId ?? null;
    try {
      const attemptRoute = { ...route, model };
      const replyText =
        route.providerId === "openai"
          ? await runOpenAi(attemptRoute, messages, images)
          : route.providerId === "anthropic"
            ? await runAnthropic(attemptRoute, messages, images)
            : await runWorkersAi(attemptRoute, messages, images);

      if (!isEmptyModelReply(replyText, attemptRoute)) {
        modelAttempts.push({
          providerId: route.providerId,
          model,
          status: "succeeded",
          error: null,
          ...singleModelAttemptMetrics(
            route,
            attemptStartedAt,
            gatewayLogIdBefore,
          ),
        });
        return {
          ok: true,
          auditId: null,
          turnId,
          specialist: "core.agent-chat",
          replyText,
          model,
          source: route.providerId,
          fallbackReason: null,
          debugError: null,
          emailAction: null,
          reminderAction: null,
          actionCards: null,
          contentAction: null,
          contactsChanged: false,
          modelAttempts,
        };
      }

      const message = "Model returned an empty reply.";
      modelAttempts.push({
        providerId: route.providerId,
        model,
        status: "empty",
        error: message,
        ...singleModelAttemptMetrics(
          route,
          attemptStartedAt,
          gatewayLogIdBefore,
        ),
      });
      lastError = new Error(emptyModelReply(attemptRoute));
    } catch (error) {
      const message = modelErrorMessage(error);
      modelAttempts.push({
        providerId: route.providerId,
        model,
        status: "failed",
        error: message,
        ...singleModelAttemptMetrics(
          route,
          attemptStartedAt,
          gatewayLogIdBefore,
        ),
      });
      lastError = error;
    }
  }

  return modelFallbackResponse(route, turnId, modelAttempts, lastError);
}

function singleModelAttemptMetrics(
  route: AgentChatAiRoute,
  startedAt: number,
  gatewayLogIdBefore: string | null,
): Pick<
  AgentChatModelAttemptTrace,
  "durationMs" | "modelRequestDurationMs" | "modelRequestCount" | "gatewayLogIds"
> {
  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  const gatewayLogId = route.ai?.aiGatewayLogId ?? null;
  return {
    durationMs,
    modelRequestDurationMs: durationMs,
    modelRequestCount: 1,
    ...(gatewayLogId && gatewayLogId !== gatewayLogIdBefore
      ? { gatewayLogIds: [gatewayLogId] }
      : {}),
  };
}

export function modelErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
}

function modelFallbackResponse(
  route: AgentChatAiRoute,
  turnId: string,
  modelAttempts: AgentChatModelAttemptTrace[],
  lastError: unknown,
): AgentSandboxDispatchResponse {
  const onlyEmptyReplies =
    modelAttempts.length > 0 &&
    modelAttempts.every((attempt) => attempt.status === "empty");
  const attemptedBackup = modelAttempts.some(
    (attempt) => attempt.model !== route.model,
  );
  const debugError =
    modelErrorMessage(lastError) ||
    modelAttempts
      .map((attempt) => attempt.error)
      .filter(Boolean)
      .join("; ") ||
    "Model request failed";

  return {
    ok: true,
    auditId: null,
    turnId,
    specialist: "core.agent-chat",
    replyText: onlyEmptyReplies
      ? [
          "I reached the configured AI model, but it returned an empty reply.",
          attemptedBackup
            ? "I also tried the backup model, but it did not return usable text."
            : null,
          "Try another model, or check Account > AI model before trying again.",
        ]
          .filter(Boolean)
          .join(" ")
      : [
          "I reached ME3, but the model provider failed before it could answer.",
          attemptedBackup
            ? "I also tried the backup model and it failed too."
            : null,
          "Check your AI provider settings or try another model.",
        ]
          .filter(Boolean)
          .join(" "),
    model: route.model,
    source: "fallback",
    fallbackReason: onlyEmptyReplies
      ? "Model returned empty response"
      : "Model request failed",
    debugError,
    emailAction: null,
    reminderAction: null,
    actionCards: null,
    contentAction: null,
    contactsChanged: false,
    modelAttempts,
  };
}

async function runOpenAi(
  route: AgentChatAiRoute,
  messages: AgentChatTextMessage[],
  images: AgentChatImageInput[] = [],
): Promise<string> {
  if (!route.apiKey) throw new Error("OpenAI API key is not configured");
  const body: Record<string, unknown> = {
    model: route.model,
    messages: withOpenAiImageContent(messages, images),
  };
  const reasoningEffort = openAiCompatibleReasoningEffort(route.model);
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (!isOpenAiReasoningModel(route.model)) {
    body.temperature = 0.4;
  }

  const gatewayUrl = externalProviderGatewayUrl(
    route,
    "openai",
    "chat/completions",
  );
  const response = await fetch(
    gatewayUrl || "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${route.apiKey}`,
        ...(gatewayUrl && route.aiGateway?.apiToken
          ? { "cf-aig-authorization": `Bearer ${route.aiGateway.apiToken}` }
          : {}),
      },
      body: JSON.stringify(body),
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `OpenAI request failed (${response.status})`,
    );
  }

  const message = payload?.choices?.[0]?.message;
  return (
    extractModelText(message?.content) ||
    extractModelText(message?.refusal) ||
    emptyModelReply(route)
  );
}

function isOpenAiReasoningModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return /^gpt-5(?:[.-]|$)/.test(normalized) || /^o\d(?:[.-]|$)/.test(normalized);
}

async function runAnthropic(
  route: AgentChatAiRoute,
  messages: AgentChatTextMessage[],
  images: AgentChatImageInput[] = [],
): Promise<string> {
  if (!route.apiKey) throw new Error("Anthropic API key is not configured");

  const system =
    messages.find((message) => message.role === "system")?.content || "";
  const turns = withAnthropicImageContent(
    messages
      .filter(
        (
          message,
        ): message is AgentChatTextMessage & { role: "user" | "assistant" } =>
          message.role !== "system",
      )
      .map((message) => ({ role: message.role, content: message.content })),
    images,
  );

  const gatewayUrl = externalProviderGatewayUrl(
    route,
    "anthropic",
    "v1/messages",
  );
  const response = await fetch(
    gatewayUrl || "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": route.apiKey,
        "anthropic-version": "2023-06-01",
        ...(gatewayUrl && route.aiGateway?.apiToken
          ? { "cf-aig-authorization": `Bearer ${route.aiGateway.apiToken}` }
          : {}),
      },
      body: JSON.stringify({
        model: route.model,
        max_tokens: 800,
        system,
        messages: turns,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        content?: Array<{ type?: string; text?: string }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `Anthropic request failed (${response.status})`,
    );
  }

  return extractModelText(payload?.content) || emptyModelReply(route);
}

async function runWorkersAi(
  route: AgentChatAiRoute,
  messages: AgentChatTextMessage[],
  images: AgentChatImageInput[] = [],
): Promise<string> {
  if (!route.ai) throw new Error("Workers AI binding is not configured");
  const requestOptions = workersAiGatewayRunOptions(route);
  const anthropicModel = route.model
    .trim()
    .toLowerCase()
    .replace(/^@cf\//, "")
    .startsWith("anthropic/");
  const normalizedModel = route.model.trim().toLowerCase().replace(/^@cf\//, "");
  const chatCompletionsVisionModel =
    normalizedModel === "moonshotai/kimi-k3" || normalizedModel.startsWith("openai/");
  const reasoningEffort = openAiCompatibleReasoningEffort(route.model);
  const system = messages.find((message) => message.role === "system")?.content || "";
  const input = anthropicModel
    ? {
        max_tokens: 800,
        system,
        messages: withAnthropicImageContent(
          messages
            .filter(
              (
                message,
              ): message is AgentChatTextMessage & { role: "user" | "assistant" } =>
                message.role !== "system",
            )
            .map((message) => ({ role: message.role, content: message.content })),
          images,
        ),
      }
    : chatCompletionsVisionModel
      ? {
          messages: withOpenAiImageContent(messages, images),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        }
    : images[0]
      ? { messages, image: images[0].dataUrl }
      : { messages };
  const result = requestOptions
    ? await route.ai.run(route.model, input, requestOptions)
    : await route.ai.run(route.model, input);
  const root = asRecord(result);
  const resultRoot = asRecord(root?.result) || root;
  const usage = resultRoot ? parseAgentModelUsage(resultRoot) : null;
  if (usage) await route.recordUsage?.({ model: route.model, usage });
  return extractModelText(result) || emptyModelReply(route);
}

function withOpenAiImageContent(
  messages: AgentChatTextMessage[],
  images: AgentChatImageInput[],
): Array<{ role: AgentChatTextMessage["role"]; content: unknown }> {
  if (images.length === 0) return messages;
  return attachImagesToLastUserMessage(messages, (message) => [
    { type: "text", text: message.content },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
    })),
  ]);
}

function withAnthropicImageContent(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  images: AgentChatImageInput[],
): Array<{ role: "user" | "assistant"; content: unknown }> {
  if (images.length === 0) return messages;
  return attachImagesToLastUserMessage(messages, (message) => [
    { type: "text", text: message.content },
    ...images.map((image) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.base64,
      },
    })),
  ]);
}

function attachImagesToLastUserMessage<
  TMessage extends { role: string; content: string },
>(
  messages: TMessage[],
  contentForMessage: (message: TMessage) => unknown,
): Array<Omit<TMessage, "content"> & { content: unknown }> {
  const lastUserIndex = messages
    .map((message) => message.role)
    .lastIndexOf("user");
  if (lastUserIndex === -1) return messages;
  return messages.map((message, index) =>
    index === lastUserIndex
      ? { ...message, content: contentForMessage(message) }
      : message,
  );
}

export function externalProviderGatewayUrl(
  route: AgentChatAiRoute,
  provider: "openai" | "anthropic",
  path: string,
): string | null {
  const gateway = route.aiGateway;
  if (
    !gateway?.routeExternalProviders ||
    !gateway.accountId ||
    !gateway.gatewayId ||
    !gateway.apiToken
  ) {
    return null;
  }
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    gateway.accountId,
  )}/${encodeURIComponent(gateway.gatewayId)}/${provider}/${path}`;
}

function extractModelText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => extractModelText(part))
      .join("")
      .trim();
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  return (
    extractModelText(record.text) ||
    extractModelText(record.output_text) ||
    extractModelText(record.response) ||
    extractModelText(record.content) ||
    extractModelText(record.parsed) ||
    extractModelText(record.data) ||
    extractModelText(record.message) ||
    extractModelText(record.choices) ||
    extractModelText(record.delta) ||
    extractModelText(record.result) ||
    extractModelText(record.output)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function emptyModelReply(route: AgentChatAiRoute): string {
  return `I reached ${route.providerId} (${route.model}), but it returned an empty reply. Check Account > AI model or try another model.`;
}

function isEmptyModelReply(replyText: string, route: AgentChatAiRoute): boolean {
  return replyText === emptyModelReply(route);
}
