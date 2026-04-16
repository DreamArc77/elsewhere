import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  completeWithPreparedSimpleCompletionModel,
  extractAssistantText,
  prepareSimpleCompletionModel,
} from "openclaw/plugin-sdk/agent-runtime";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";

import {
  companionReplyPlanJsonSchema,
  companionReplyPlanSchema,
  extractLikelyJson,
  parseModelJson,
  tripPlanJsonSchema,
  tripPlanSchema,
} from "../contracts/schemas.js";
import {
  resolveAgentState,
  resolveAgentStateForTimelineStep,
} from "../domain/business-situation.js";
import {
  CompanionReplyPlan,
  CompanionTurn,
  GroundingPort,
  ImageGenerationPort,
  ImageGenerationResult,
  InboundUserMessage,
  LogEntry,
  LoggerPort,
  PhaseGroundingResult,
  ResolvedAgentState,
  RuntimeStepContext,
  StoredPersonaProfile,
  TravelCompanionTextProviderConfig,
  TripPhase,
  TripPlan,
  TripRecord,
  TripRequest,
} from "../domain/types.js";
import {
  renderCaptionPrompt,
  renderCompanionReplyPrompt,
  renderTripPlanPrompt,
} from "../prompting/travel-companion-prompts.js";

interface GeminiOptions {
  apiKey?: string;
  apiKeyResolver?: () => Promise<string | undefined> | string | undefined;
  textProviderResolver?:
    | (() =>
        | Promise<TravelCompanionTextProviderConfig | undefined>
        | TravelCompanionTextProviderConfig
        | undefined)
    | undefined;
  runtime?: PluginRuntime;
  baseUrl?: string;
  planningModel?: string;
  textModel?: string;
  imageModel?: string;
  fetchImpl?: typeof fetch;
  logger?: LoggerPort;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { data?: string; mimeType?: string };
        inline_data?: { data?: string; mime_type?: string };
      }>;
    };
  }>;
}

function resolveHostDefaultModelRef(input: {
  configuredModel: unknown;
  runtimeProvider: unknown;
  runtimeModel: unknown;
}): { provider: string; modelId: string } | null {
  const runtimeProvider =
    typeof input.runtimeProvider === "string" && input.runtimeProvider.trim()
      ? input.runtimeProvider.trim()
      : undefined;

  const resolveFromUnknown = (
    value: unknown,
    fallbackProvider?: string,
  ): { provider: string; modelId: string } | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const slashIndex = trimmed.indexOf("/");
      if (slashIndex > 0) {
        return {
          provider: trimmed.slice(0, slashIndex).trim(),
          modelId: trimmed.slice(slashIndex + 1).trim(),
        };
      }

      if (!fallbackProvider) {
        return null;
      }

      return {
        provider: fallbackProvider,
        modelId: trimmed,
      };
    }

    if (!value || typeof value !== "object") {
      return null;
    }

    const record = value as Record<string, unknown>;

    if (typeof record.primary === "string") {
      return resolveFromUnknown(record.primary, fallbackProvider);
    }

    if (typeof record.id === "string") {
      return resolveFromUnknown(
        typeof record.provider === "string"
          ? `${record.provider}/${record.id}`
          : record.id,
        typeof record.provider === "string"
          ? record.provider
          : fallbackProvider,
      );
    }

    if (
      typeof record.provider === "string" &&
      typeof record.model === "string"
    ) {
      return {
        provider: record.provider.trim(),
        modelId: record.model.trim(),
      };
    }

    return null;
  };

  return (
    resolveFromUnknown(input.configuredModel, runtimeProvider) ??
    resolveFromUnknown(input.runtimeModel, runtimeProvider)
  );
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (
    baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/, "");
}

function extractText(response: GenerateContentResponse): string {
  const part = response.candidates?.[0]?.content?.parts?.find(
    (candidatePart) => typeof candidatePart.text === "string",
  );

  if (!part?.text) {
    throw new Error("Gemini response did not contain a text part.");
  }

  return part.text;
}

function extractOptionalText(
  response: GenerateContentResponse,
): string | undefined {
  const text = response.candidates?.[0]?.content?.parts?.find(
    (candidatePart) => typeof candidatePart.text === "string",
  )?.text;
  return text?.trim() ? text.trim() : undefined;
}

function extractOptionalImageSummary(
  response: GenerateContentResponse,
): string | undefined {
  const text = extractOptionalText(response);
  if (!text) {
    return undefined;
  }

  try {
    return extractLikelyJson(text);
  } catch {
    return text;
  }
}

function extractImage(response: GenerateContentResponse): ImageGenerationResult {
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part) => Boolean(part.inlineData?.data || part.inline_data?.data),
  );

  const bytesBase64 =
    imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;
  const mimeType =
    imagePart?.inlineData?.mimeType ?? imagePart?.inline_data?.mime_type;

  if (!bytesBase64 || !mimeType) {
    throw new Error("Gemini response did not contain inline image bytes.");
  }

  return {
    bytesBase64,
    mimeType,
    provider: "gemini",
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

function summarizePlanResponseText(text: string): {
  responseTextLength: number;
  responseTextPreviewHead: string;
  responseTextPreviewTail: string;
  responseTextStartsWith: string;
  responseTextEndsWith: string;
  responseTextLooksJsonComplete: boolean;
} {
  const trimmed = text.trim();
  return {
    responseTextLength: trimmed.length,
    responseTextPreviewHead: truncate(trimmed.slice(0, 400), 400),
    responseTextPreviewTail: truncate(trimmed.slice(-400), 400),
    responseTextStartsWith: trimmed.slice(0, 40),
    responseTextEndsWith: trimmed.slice(-40),
    responseTextLooksJsonComplete:
      trimmed.startsWith("{") && trimmed.endsWith("}"),
  };
}

function shouldRetryPlanWithoutGrounding(errorMessage: string): boolean {
  return (
    errorMessage.includes("User location is not supported for the API use.") ||
    errorMessage.includes('"status": "FAILED_PRECONDITION"')
  );
}

function latestPendingUserMessageAt(
  pendingUserMessages: InboundUserMessage[],
): string {
  return (
    pendingUserMessages[pendingUserMessages.length - 1]?.receivedAt ??
    "No pending user messages."
  );
}

function buildCurrentStateSummary(input: {
  resolvedState: ResolvedAgentState;
}): string {
  return JSON.stringify(
    {
      identity: input.resolvedState.identity,
      stage: input.resolvedState.stage,
      state: {
        location: input.resolvedState.state.location ?? null,
        address: input.resolvedState.state.address ?? null,
        presence: input.resolvedState.state.presence,
        weatherForecast: input.resolvedState.state.weatherForecast ?? null,
        phaseLabel: input.resolvedState.state.phaseLabel ?? null,
        source: input.resolvedState.state.source,
        note: input.resolvedState.state.note ?? null,
      },
    },
    null,
    2,
  );
}

function buildCurrentStateGrounding(
  resolvedState: ResolvedAgentState,
): string {
  if (
    !resolvedState.state.currentActivity &&
    !resolvedState.state.previousActivity &&
    !resolvedState.state.nextActivity
  ) {
    return JSON.stringify(
      {
        stateSource: resolvedState.state.source,
        note:
          resolvedState.state.note ??
          "No activity-like grounding is available for this state.",
        weatherForecast: resolvedState.state.weatherForecast ?? null,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      stateSource: resolvedState.state.source,
      weatherForecast: resolvedState.state.weatherForecast ?? null,
      stateStartedAt: resolvedState.stage.startedAtUtc,
      stateEndsAt: resolvedState.stage.endsAtUtc ?? null,
      currentActivity: resolvedState.state.currentActivity
        ? {
            type: resolvedState.state.currentActivity.type,
            location: resolvedState.state.currentActivity.location,
            address: resolvedState.state.currentActivity.address,
            description: resolvedState.state.currentActivity.description,
            arrivalContext: resolvedState.state.currentActivity.arrival_context,
            route: resolvedState.state.currentActivity.route ?? null,
            liveUpdate:
              resolvedState.state.currentActivity.real_time_info.live_update,
          }
        : null,
      previousActivity: resolvedState.state.previousActivity
        ? {
            type: resolvedState.state.previousActivity.type,
            location: resolvedState.state.previousActivity.location,
            description: resolvedState.state.previousActivity.description,
          }
        : null,
      nextActivity: resolvedState.state.nextActivity
        ? {
            type: resolvedState.state.nextActivity.type,
            location: resolvedState.state.nextActivity.location,
            description: resolvedState.state.nextActivity.description,
          }
        : null,
      arrivalContext: resolvedState.state.arrivalContext ?? null,
      route: resolvedState.state.route ?? null,
      note: resolvedState.state.note ?? null,
    },
    null,
    2,
  );
}

function buildCurrentTransportDetails(input: {
  activeTrip: TripRecord | null;
  resolvedState: ResolvedAgentState;
}): string {
  if (!input.activeTrip) {
    return JSON.stringify({ relevant: false }, null, 2);
  }

  const stage = input.resolvedState.stage;
  const state = input.resolvedState.state;
  const departureLeg = input.activeTrip.plan.transportation.departure;
  const returnLeg = input.activeTrip.plan.transportation.return;

  const isReturnLeg =
    stage.group === "return" || state.phaseLabel === "returning";
  const isMainLegStage =
    stage.substate === "before_departure" ||
    stage.substate === "departing" ||
    stage.substate === "arrive";

  if (isMainLegStage) {
    const leg = isReturnLeg ? returnLeg : departureLeg;
    return JSON.stringify(
      {
        relevant: true,
        leg: isReturnLeg ? "return" : "departure",
        type: leg.type,
        transportMode: leg.transport_mode,
        identifier: leg.identifier,
        operator: leg.operator,
        departure: leg.departure,
        arrival: leg.arrival,
      },
      null,
      2,
    );
  }

  const currentActivity = input.resolvedState.state.currentActivity;
  if (stage.substate === "transport" && currentActivity?.route) {
    return JSON.stringify(
      {
        relevant: true,
        leg: "local_transport",
        transportMode:
          currentActivity.route.transport_mode ??
          currentActivity.arrival_context.transport_mode,
        route: currentActivity.route,
        arrivalContext: currentActivity.arrival_context,
        description: currentActivity.description,
      },
      null,
      2,
    );
  }

  return JSON.stringify({ relevant: false }, null, 2);
}

function buildRecentPhotoContext(input: {
  latestPostcardPhoto?: {
    tripId: string;
    sentAt: string;
    shotKind: string;
    caption: string;
    imageSummary?: string;
  };
}): string {
  if (!input.latestPostcardPhoto) {
    return JSON.stringify({ available: false }, null, 2);
  }

  let parsedSummary: unknown = input.latestPostcardPhoto.imageSummary ?? null;
  if (typeof parsedSummary === "string") {
    try {
      parsedSummary = JSON.parse(parsedSummary);
    } catch {
      parsedSummary = parsedSummary;
    }
  }

  return JSON.stringify(
    {
      available: true,
      sentAt: input.latestPostcardPhoto.sentAt,
      shotKind: input.latestPostcardPhoto.shotKind,
      caption: input.latestPostcardPhoto.caption,
      imageSummary: parsedSummary,
    },
    null,
    2,
  );
}

function mimeTypeFromPath(path: string): string {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function elapsedMs(startedAt: string, finishedAt: string): number {
  return new Date(finishedAt).getTime() - new Date(startedAt).getTime();
}

abstract class BaseGeminiAdapter {
  protected readonly apiKey?: string;
  protected readonly apiKeyResolver?: () => Promise<string | undefined> | string | undefined;
  protected readonly textProviderResolver?:
    | (() =>
        | Promise<TravelCompanionTextProviderConfig | undefined>
        | TravelCompanionTextProviderConfig
        | undefined)
    | undefined;
  protected readonly runtime?: PluginRuntime;
  protected readonly baseUrl: string;
  protected readonly fetchImpl: typeof fetch;
  protected readonly logger?: LoggerPort;

  constructor(options: GeminiOptions) {
    this.apiKey = options.apiKey;
    this.apiKeyResolver = options.apiKeyResolver;
    this.textProviderResolver = options.textProviderResolver;
    this.runtime = options.runtime;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
  }

  protected async resolveApiKey(): Promise<string> {
    const resolved = (await this.apiKeyResolver?.()) ?? this.apiKey;
    if (!resolved?.trim()) {
      throw new Error(
        "Gemini API key is not configured. Complete onboarding and provide a Gemini key first.",
      );
    }
    return resolved.trim();
  }

  protected async generateContent(
    model: string,
    body: Record<string, unknown>,
  ): Promise<GenerateContentResponse> {
    const apiKey = await this.resolveApiKey();
    const response = await this.fetchImpl(
      `${this.baseUrl}/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini request failed: ${response.status} ${response.statusText}${
          errorText ? ` - ${truncate(errorText, 600)}` : ""
        }`,
      );
    }

    return (await response.json()) as GenerateContentResponse;
  }
}

type TextCompletionMode =
  | {
      kind: "text";
      temperature?: number;
    }
  | {
      kind: "json";
      temperature?: number;
      jsonSchema?: Record<string, unknown>;
    };

type TextCompletionResult = {
  text: string;
  provider: string;
};

export class GeminiRestGroundingAdapter
  extends BaseGeminiAdapter
  implements GroundingPort
{
  private readonly planningModel: string;
  private readonly textModel: string;

  constructor(options: GeminiOptions) {
    super(options);
    this.planningModel = options.planningModel ?? "gemini-3-flash-preview";
    this.textModel = options.textModel ?? "gemini-3-flash-preview";
  }

  private async logPlanEntry(entry: LogEntry): Promise<void> {
    await this.logger?.log(entry);
  }

  private async logPromptEntry(entry: LogEntry): Promise<void> {
    await this.logger?.log(entry);
  }

  private async resolveTextProviderConfig(): Promise<TravelCompanionTextProviderConfig> {
    return (await this.textProviderResolver?.()) ?? { kind: "host-default" };
  }

  private async completeWithGemini(
    prompt: string,
    mode: TextCompletionMode,
  ): Promise<TextCompletionResult> {
    const response = await this.generateContent(this.textModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig:
        mode.kind === "json"
          ? {
              responseMimeType: "application/json",
              responseJsonSchema: mode.jsonSchema,
              temperature: mode.temperature ?? 0.8,
            }
          : {
              temperature: mode.temperature ?? 0.8,
            },
    });

    return {
      text: extractText(response),
      provider: this.textModel,
    };
  }

  private async completeWithHostDefault(
    prompt: string,
  ): Promise<TextCompletionResult> {
    if (!this.runtime) {
      throw new Error(
        "Host-default text provider is unavailable because plugin runtime was not injected.",
      );
    }

    const cfg = this.runtime.config.loadConfig();
    const resolvedHostDefault = resolveHostDefaultModelRef({
      configuredModel: cfg.agents?.defaults?.model,
      runtimeProvider: this.runtime.agent.defaults.provider,
      runtimeModel: this.runtime.agent.defaults.model,
    });
    const provider = resolvedHostDefault?.provider;
    const modelId = resolvedHostDefault?.modelId;

    if (!provider || !modelId) {
      throw new Error(
        "Could not resolve OpenClaw default provider/model for host-default text generation.",
      );
    }

    const prepared = await prepareSimpleCompletionModel({
      cfg,
      provider,
      modelId,
    });
    if ("error" in prepared) {
      throw new Error(prepared.error);
    }

    const assistantMessage = await completeWithPreparedSimpleCompletionModel({
      model: prepared.model,
      auth: prepared.auth,
      context: {
        messages: [
          {
            role: "user",
            content: prompt,
            timestamp: Date.now(),
          },
        ],
      },
      options: {
        maxTokens: 1200,
      },
    });
    const text = extractAssistantText(assistantMessage)?.trim();
    if (!text) {
      throw new Error(
        "Host-default text provider returned an empty assistant message.",
      );
    }

    return {
      text,
      provider: `${provider}:${modelId}`,
    };
  }

  private async completeWithOpenAICompatible(
    prompt: string,
    mode: TextCompletionMode,
    config: TravelCompanionTextProviderConfig,
  ): Promise<TextCompletionResult> {
    const baseUrl = config.baseUrl?.trim();
    const apiKey = config.apiKey?.trim();
    const model = config.model?.trim();

    if (!baseUrl || !apiKey || !model) {
      throw new Error(
        "OpenAI-compatible text provider is missing baseUrl, apiKey, or model.",
      );
    }

    const response = await this.fetchImpl(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: mode.temperature ?? 0.8,
          messages: [{ role: "user", content: prompt }],
          ...(mode.kind === "json"
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI-compatible request failed: ${response.status} ${response.statusText}${
          errorText ? ` - ${truncate(errorText, 600)}` : ""
        }`,
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?:
            | string
            | Array<{
                type?: string;
                text?: string;
              }>;
        };
      }>;
    };
    const rawContent = payload.choices?.[0]?.message?.content;
    const text =
      typeof rawContent === "string"
        ? rawContent.trim()
        : Array.isArray(rawContent)
          ? rawContent
              .map((part) => (typeof part?.text === "string" ? part.text : ""))
              .join("")
              .trim()
          : "";

    if (!text) {
      throw new Error(
        "OpenAI-compatible text provider did not return message content.",
      );
    }

    return {
      text,
      provider: `openai-compatible:${model}`,
    };
  }

  private async completeTextPrompt(
    prompt: string,
    mode: TextCompletionMode,
  ): Promise<TextCompletionResult> {
    const textProvider = await this.resolveTextProviderConfig();

    switch (textProvider.kind) {
      case "gemini":
        return await this.completeWithGemini(prompt, mode);
      case "openai-compatible":
        return await this.completeWithOpenAICompatible(
          prompt,
          mode,
          textProvider,
        );
      case "host-default":
      default:
        return await this.completeWithHostDefault(prompt);
    }
  }

  private async describeTextProvider(): Promise<string> {
    const textProvider = await this.resolveTextProviderConfig();
    switch (textProvider.kind) {
      case "gemini":
        return this.textModel;
      case "openai-compatible":
        return `openai-compatible:${textProvider.model ?? "unknown"}`;
      case "host-default":
      default:
        return "host-default";
    }
  }

  async planTrip(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
  }): Promise<TripPlan> {
    const basePrompt = await renderTripPlanPrompt(input);
    const prompts = [
      basePrompt,
      [
        basePrompt,
        "",
        "纠错提醒：上一次输出不合格。请重新生成完整 JSON，并严格遵守这些额外要求：",
        "1. 不允许把用户写进旅行现场，用户只是远端收消息的人。",
        "2. 不允许出现恋爱对白、病娇台词、威胁、占有欲、牵手、见面、同行叙事。",
        "3. `description`、`arrival_context`、`route`、`live_update` 必须是客观、可执行的旅行信息。",
        "4. 日期必须晚于或等于今天，不能回到过去年份。",
      ].join("\n"),
    ];

    prompts[1] = [
      basePrompt,
      "",
      "错误提醒：上一次输出不合格。请重新生成完整 JSON，并严格遵守这些额外要求：",
      "1. 不允许把用户写进旅行现场，用户只是远端收消息的人。",
      "2. 不允许出现恋爱对白、病娇台词、威胁、占有欲、牵手、见面、同行叙事。",
      "3. `description`、`arrival_context`、`route`、`live_update` 必须是客观、可执行的旅行信息。",
      "4. 日期必须晚于或等于今天，不能回到过去年份。",
    ].join("\n");

    let lastError: unknown;
    const runId = `plan:${input.tripId}`;

    for (const [index, prompt] of prompts.entries()) {
      const attempt = index + 1;
      let usesGoogleSearch = true;

      while (true) {
        const requestStartedAt = nowIso();

        await this.logPromptEntry({
          tripId: input.tripId,
          runId,
          phase: "planning",
          event: "plan.prompt.rendered",
          decision:
            "Rendered the final planning prompt before sending it to Gemini.",
          provider: this.planningModel,
          status: "success",
          startedAt: requestStartedAt,
          finishedAt: requestStartedAt,
          latencyMs: 0,
          details: {
            attempt,
            usesGoogleSearch,
            promptLength: prompt.length,
            renderedPrompt: prompt,
          },
        });

        await this.logPlanEntry({
          tripId: input.tripId,
          runId,
          phase: "planning",
          event: "plan.request.started",
          decision: "Started Gemini trip planning request.",
          provider: this.planningModel,
          status: "success",
          startedAt: requestStartedAt,
          finishedAt: requestStartedAt,
          latencyMs: 0,
          details: {
            attempt,
            usesGoogleSearch,
            promptLength: prompt.length,
            destinationCity: input.request.destinationCity,
          },
        });

        try {
          const response = await this.generateContent(this.planningModel, {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            ...(usesGoogleSearch ? { tools: [{ google_search: {} }] } : {}),
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: tripPlanJsonSchema,
              temperature: 0.3,
            },
          });

          const responseFinishedAt = nowIso();
          const responseText = extractText(response);
          await this.logPlanEntry({
            tripId: input.tripId,
            runId,
            phase: "planning",
            event: "plan.request.finished",
            decision: "Gemini trip planning request returned a response payload.",
            provider: this.planningModel,
            status: "success",
            startedAt: requestStartedAt,
            finishedAt: responseFinishedAt,
            latencyMs: elapsedMs(requestStartedAt, responseFinishedAt),
            details: {
              attempt,
              usesGoogleSearch,
              ...summarizePlanResponseText(responseText),
            },
          });

          const parseStartedAt = nowIso();
          let parsed: TripPlan;
          try {
            parsed = parseModelJson(
              responseText,
              tripPlanSchema,
              "Gemini trip plan",
            );
          } catch (error) {
            if (error instanceof Error) {
              Object.assign(error, { responseText });
            }
            throw error;
          }
          const parseFinishedAt = nowIso();

          await this.logPlanEntry({
            tripId: input.tripId,
            runId,
            phase: "planning",
            event: "plan.parse.finished",
            decision: "Validated trip plan JSON against the contract schema.",
            provider: this.planningModel,
            status: "success",
            startedAt: parseStartedAt,
            finishedAt: parseFinishedAt,
            latencyMs: elapsedMs(parseStartedAt, parseFinishedAt),
            details: {
              attempt,
              usesGoogleSearch,
              days: parsed.metadata.days,
            },
          });

          return parsed;
        } catch (error) {
          lastError = error;
          const failedAt = nowIso();
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const responseText =
            error instanceof Error &&
            "responseText" in (error as object) &&
            typeof (error as Error & { responseText?: unknown }).responseText ===
              "string"
              ? (error as Error & { responseText: string }).responseText
              : undefined;

          if (
            usesGoogleSearch &&
            shouldRetryPlanWithoutGrounding(errorMessage)
          ) {
            await this.logPlanEntry({
              tripId: input.tripId,
              runId,
              phase: "planning",
              event: "plan.request.retry_without_grounding",
              decision:
                "Gemini rejected the grounded planning request; retrying the same prompt without Google Search grounding.",
              provider: this.planningModel,
              status: "failure",
              startedAt: requestStartedAt,
              finishedAt: failedAt,
              latencyMs: elapsedMs(requestStartedAt, failedAt),
              errorCode: "plan_generation_failed",
              details: {
                attempt,
                usesGoogleSearch,
                error: truncate(errorMessage, 600),
              },
            });
            usesGoogleSearch = false;
            continue;
          }

          await this.logPlanEntry({
            tripId: input.tripId,
            runId,
            phase: "planning",
            event:
              attempt < prompts.length ? "plan.request.retry" : "plan.request.failed",
            decision:
              attempt < prompts.length
                ? "Gemini trip planning attempt failed; retrying with a stricter corrective prompt."
                : "Gemini trip planning failed after exhausting all attempts.",
            provider: this.planningModel,
            status: "failure",
            startedAt: requestStartedAt,
            finishedAt: failedAt,
            latencyMs: elapsedMs(requestStartedAt, failedAt),
            errorCode: "plan_generation_failed",
            details: {
              attempt,
              usesGoogleSearch,
              error: truncate(errorMessage, 600),
              ...(responseText ? summarizePlanResponseText(responseText) : {}),
            },
          });
          break;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Gemini trip plan generation failed.");
  }

  async composeCaption(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
    stepContext: RuntimeStepContext;
    grounding: PhaseGroundingResult;
    resolvedState: ResolvedAgentState;
    imagePrompt: string;
  }): Promise<{ caption: string; provider: string }> {
    const startedAt = nowIso();
    const promptProvider = await this.describeTextProvider();
    const currentStateSummary = buildCurrentStateSummary({
      resolvedState: input.resolvedState,
    });
    const currentStateGrounding = buildCurrentStateGrounding(input.resolvedState);
    const prompt = await renderCaptionPrompt({
      persona: input.persona,
      request: input.request,
      phase: input.phase,
      day: input.day,
      stepContext: input.stepContext,
      grounding: input.grounding,
      resolvedState: input.resolvedState,
      currentStateSummary,
      currentStateGrounding,
      imagePrompt: input.imagePrompt,
    });

    await this.logPromptEntry({
      tripId: input.tripId,
      runId: `caption:${input.tripId}:${input.phase}:${input.day}:${input.stepContext.activityIndex}:${input.stepContext.sendMoment}`,
      phase: input.phase,
      event: "caption.prompt.rendered",
      decision: "Rendered the final postcard caption prompt before sending it to the selected text provider.",
      provider: promptProvider,
      status: "success",
      startedAt,
      finishedAt: startedAt,
      latencyMs: 0,
      details: {
        day: input.day,
        substate: input.resolvedState.stage.substate,
        promptLength: prompt.length,
        renderedPrompt: prompt,
      },
    });

    const response = await this.completeTextPrompt(prompt, {
      kind: "text",
      temperature: 0.8,
    });

    return {
      caption: extractLikelyJson(response.text)
        .replace(/^"|"$/g, "")
        .trim(),
      provider: response.provider,
    };
  }

  async composeCompanionReply(input: {
    conversationKey: string;
    persona: StoredPersonaProfile | null;
    pendingUserMessages: InboundUserMessage[];
    recentTurns: CompanionTurn[];
    latestPostcardPhoto?: {
      tripId: string;
      sentAt: string;
      shotKind: string;
      caption: string;
      imageSummary?: string;
    };
    activeTrip: TripRecord | null;
    resolvedState: ResolvedAgentState;
    now: string;
  }): Promise<CompanionReplyPlan> {
    const startedAt = nowIso();
    const promptProvider = await this.describeTextProvider();
    const currentStateSummary = buildCurrentStateSummary({
      resolvedState: input.resolvedState,
    });
    const currentStateGrounding = buildCurrentStateGrounding(input.resolvedState);
    const currentTransportDetails = buildCurrentTransportDetails({
      activeTrip: input.activeTrip,
      resolvedState: input.resolvedState,
    });
    const prompt = await renderCompanionReplyPrompt({
      persona: input.persona,
      conversationKey: input.conversationKey,
      pendingUserMessages: JSON.stringify(input.pendingUserMessages, null, 2),
      recentTurns: JSON.stringify(input.recentTurns, null, 2),
      recentPhotoContext: buildRecentPhotoContext({
        latestPostcardPhoto: input.latestPostcardPhoto,
      }),
      activeTripSummary: JSON.stringify(
        input.activeTrip
          ? {
              tripId: input.activeTrip.tripId,
              destination: input.activeTrip.request.destinationCity,
              phase: input.activeTrip.state.currentPhase,
              day: input.activeTrip.state.currentDay,
              nextRunAt: input.activeTrip.state.nextRunAt,
              stage: input.resolvedState.stage,
              state: input.resolvedState.state,
            }
          : {
              status: "idle",
              note: "No active trip right now.",
              stage: input.resolvedState.stage,
              state: input.resolvedState.state,
            },
        null,
        2,
      ),
      currentStateSummary,
      currentStateGrounding,
      currentTransportDetails,
      now: input.now,
      latestUserMessageAt: latestPendingUserMessageAt(input.pendingUserMessages),
    });

    await this.logPromptEntry({
      tripId: input.activeTrip?.tripId ?? `conversation:${input.conversationKey}`,
      runId: `reply:${input.conversationKey}:${startedAt}`,
      phase: input.activeTrip?.state.currentPhase ?? "system",
      event: "reply.prompt.rendered",
      decision: "Rendered the final reply prompt before sending it to the selected text provider.",
      provider: promptProvider,
      status: "success",
      startedAt,
      finishedAt: startedAt,
      latencyMs: 0,
      details: {
        conversationKey: input.conversationKey,
        substate: input.resolvedState.stage.substate,
        promptLength: prompt.length,
        renderedPrompt: prompt,
      },
    });

    const response = await this.completeTextPrompt(prompt, {
      kind: "json",
      temperature: 0.8,
      jsonSchema: companionReplyPlanJsonSchema,
    });

    return {
      ...parseModelJson(
        response.text,
        companionReplyPlanSchema,
        "Gemini companion reply",
      ),
      provider: response.provider,
    };
  }
}

export class GeminiRestImageAdapter
  extends BaseGeminiAdapter
  implements ImageGenerationPort
{
  private readonly imageModel: string;

  constructor(options: GeminiOptions) {
    super(options);
    this.imageModel = options.imageModel ?? "gemini-3.1-flash-image-preview";
  }

  private async logPromptEntry(entry: LogEntry): Promise<void> {
    await this.logger?.log(entry);
  }

  async generateImage(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
    stepContext: RuntimeStepContext;
    grounding: PhaseGroundingResult;
    shotKind: "selfie" | "snapshot";
    usesReferenceImage: boolean;
    prompt: string;
  }): Promise<ImageGenerationResult> {
    const startedAt = nowIso();
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];

    await this.logPromptEntry({
      tripId: input.tripId,
      runId: `image:${input.tripId}:${input.phase}:${input.day}:${input.stepContext.activityIndex}:${input.stepContext.sendMoment}`,
      phase: input.phase,
      event: "image.prompt.rendered",
      decision: "Rendered the final image-generation prompt before sending it to Gemini.",
      provider: this.imageModel,
      status: "success",
      startedAt,
      finishedAt: startedAt,
      latencyMs: 0,
      details: {
        day: input.day,
        shotKind: input.shotKind,
        usesReferenceImage: input.usesReferenceImage,
        promptLength: input.prompt.length,
        renderedPrompt: input.prompt,
      },
    });

    if (input.usesReferenceImage) {
      const imageBytes = await readFile(input.persona.referenceImageAsset);
      const mimeType = mimeTypeFromPath(input.persona.referenceImageAsset);
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: imageBytes.toString("base64"),
        },
      });
    }

    const body = {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      tools: [
        {
          google_search: {
            searchTypes: {
              webSearch: {},
              imageSearch: {},
            },
          },
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "4:5",
          imageSize: "1K",
        },
      },
    };

    const response = await this.generateContent(this.imageModel, body);
    return {
      ...extractImage(response),
      provider: this.imageModel,
      promptEcho: input.prompt,
      imageSummary: extractOptionalImageSummary(response),
    };
  }
}
