import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  companionReplyPlanJsonSchema,
  companionReplyPlanSchema,
  extractLikelyJson,
  parseModelJson,
  tripPlanJsonSchema,
  tripPlanSchema,
} from "../contracts/schemas.js";
import { deriveCompanionState } from "../domain/business-situation.js";
import {
  CompanionBusinessSituation,
  CompanionReplyPlan,
  CompanionTurn,
  GroundingPort,
  ImageGenerationPort,
  ImageGenerationResult,
  InboundUserMessage,
  PhaseGroundingResult,
  RuntimeStepContext,
  StoredPersonaProfile,
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
  apiKey: string;
  baseUrl?: string;
  planningModel?: string;
  textModel?: string;
  imageModel?: string;
  fetchImpl?: typeof fetch;
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

function latestPendingUserMessageAt(
  pendingUserMessages: InboundUserMessage[],
): string {
  return (
    pendingUserMessages[pendingUserMessages.length - 1]?.receivedAt ??
    "No pending user messages."
  );
}

function buildCurrentStateSummary(input: {
  activeTrip: TripRecord | null;
  businessSituation: CompanionBusinessSituation;
  now: string;
}): string {
  if (!input.activeTrip) {
    return JSON.stringify(
      {
        mode: input.businessSituation.mode,
        scene: input.businessSituation.scene,
        presence: input.businessSituation.presence,
        stateSource: "clock",
        note: "No active trip right now.",
      },
      null,
      2,
    );
  }

  const derived = deriveCompanionState(
    input.activeTrip,
    new Date(input.now),
  );
  return JSON.stringify(
    {
      tripId: input.activeTrip.tripId,
      destination: input.activeTrip.request.destinationCity,
      mode: input.businessSituation.mode,
      state: input.businessSituation.state,
      substate: input.businessSituation.substate,
      scene: input.businessSituation.scene,
      presence: input.businessSituation.presence,
      phase: input.businessSituation.currentPhase,
      day: input.businessSituation.currentDay,
      contextKind: input.businessSituation.contextKind,
      sendMoment: input.businessSituation.sendMoment,
      postcardEligible: input.businessSituation.postcardEligible,
      isExtraMessage: input.businessSituation.isExtraMessage,
      stateStartedAt: input.businessSituation.stateStartedAt ?? null,
      stateEndsAt: input.businessSituation.stateEndsAt ?? null,
      stateSource: derived.source ?? "clock",
      weatherForecast: derived.weatherForecast ?? null,
    },
    null,
    2,
  );
}

function buildCurrentStateGrounding(
  activeTrip: TripRecord | null,
  now: string,
): string {
  if (!activeTrip) {
    return JSON.stringify(
      {
        note: "Idle state. No trip grounding is available right now.",
      },
      null,
      2,
    );
  }

  const derived = deriveCompanionState(activeTrip, new Date(now));
  if (!derived.currentActivity && !derived.previousActivity && !derived.nextActivity) {
    return JSON.stringify(
      {
        stateSource: derived.source ?? "clock",
        note: "Trip exists, but there is no current activity-like grounding for this state.",
        weatherForecast: derived.weatherForecast ?? null,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      stateSource: derived.source ?? "clock",
      weatherForecast: derived.weatherForecast ?? null,
      stateStartedAt: derived.timing.startedAt,
      stateEndsAt: derived.timing.endsAt ?? null,
      currentActivity: derived.currentActivity
        ? {
            type: derived.currentActivity.type,
            location: derived.currentActivity.location,
            address: derived.currentActivity.address,
            description: derived.currentActivity.description,
            arrivalContext: derived.currentActivity.arrival_context,
            route: derived.currentActivity.route ?? null,
            liveUpdate: derived.currentActivity.real_time_info.live_update,
          }
        : null,
      previousActivity: derived.previousActivity
        ? {
            type: derived.previousActivity.type,
            location: derived.previousActivity.location,
            description: derived.previousActivity.description,
          }
        : null,
      nextActivity: derived.nextActivity
        ? {
            type: derived.nextActivity.type,
            location: derived.nextActivity.location,
            description: derived.nextActivity.description,
          }
        : null,
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

abstract class BaseGeminiAdapter {
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly fetchImpl: typeof fetch;

  constructor(options: GeminiOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  protected async generateContent(
    model: string,
    body: Record<string, unknown>,
  ): Promise<GenerateContentResponse> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
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

    let lastError: unknown;
    for (const prompt of prompts) {
      try {
        const response = await this.generateContent(this.planningModel, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: tripPlanJsonSchema,
            temperature: 0.3,
          },
        });

        return parseModelJson(
          extractText(response),
          tripPlanSchema,
          "Gemini trip plan",
        );
      } catch (error) {
        lastError = error;
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
    imagePrompt: string;
  }): Promise<{ caption: string; provider: string }> {
    const prompt = await renderCaptionPrompt({
      persona: input.persona,
      request: input.request,
      phase: input.phase,
      day: input.day,
      stepContext: input.stepContext,
      grounding: input.grounding,
      imagePrompt: input.imagePrompt,
    });

    const response = await this.generateContent(this.textModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
      },
    });

    return {
      caption: extractLikelyJson(extractText(response))
        .replace(/^"|"$/g, "")
        .trim(),
      provider: this.textModel,
    };
  }

  async composeCompanionReply(input: {
    conversationKey: string;
    persona: StoredPersonaProfile | null;
    pendingUserMessages: InboundUserMessage[];
    recentTurns: CompanionTurn[];
    activeTrip: TripRecord | null;
    businessSituation: CompanionBusinessSituation;
    now: string;
  }): Promise<CompanionReplyPlan> {
    const currentStateSummary = buildCurrentStateSummary({
      activeTrip: input.activeTrip,
      businessSituation: input.businessSituation,
      now: input.now,
    });
    const currentStateGrounding = buildCurrentStateGrounding(
      input.activeTrip,
      input.now,
    );
    const prompt = await renderCompanionReplyPrompt({
      persona: input.persona,
      conversationKey: input.conversationKey,
      pendingUserMessages: JSON.stringify(input.pendingUserMessages, null, 2),
      recentTurns: JSON.stringify(input.recentTurns, null, 2),
      activeTripSummary: JSON.stringify(
        input.activeTrip
          ? {
              tripId: input.activeTrip.tripId,
              destination: input.activeTrip.request.destinationCity,
              phase: input.activeTrip.state.currentPhase,
              day: input.activeTrip.state.currentDay,
              nextRunAt: input.activeTrip.state.nextRunAt,
              businessSituation: input.businessSituation,
            }
          : {
              status: "idle",
              note: "No active trip right now.",
              businessSituation: input.businessSituation,
            },
        null,
        2,
      ),
      currentStateSummary,
      currentStateGrounding,
      now: input.now,
      latestUserMessageAt: latestPendingUserMessageAt(input.pendingUserMessages),
    });

    const response = await this.generateContent(this.textModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: companionReplyPlanJsonSchema,
        temperature: 0.8,
      },
    });

    return {
      ...parseModelJson(
        extractText(response),
        companionReplyPlanSchema,
        "Gemini companion reply",
      ),
      provider: this.textModel,
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
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];

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
    };
  }
}
