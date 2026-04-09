import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  extractLikelyJson,
  parseModelJson,
  tripPlanJsonSchema,
  tripPlanSchema,
} from "../contracts/schemas.js";
import {
  GroundingPort,
  ImageGenerationPort,
  ImageGenerationResult,
  PhaseGroundingResult,
  RuntimeStepContext,
  StoredPersonaProfile,
  TripPhase,
  TripPlan,
  TripRequest,
} from "../domain/types.js";
import {
  renderCaptionPrompt,
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
        "3. `description`、`transport_memo`、`live_update` 必须是客观、可执行的旅行信息。",
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
