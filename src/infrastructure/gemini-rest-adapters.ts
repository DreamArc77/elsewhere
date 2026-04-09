import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  extractLikelyJson,
  parseModelJson,
  phaseGroundingJsonSchema,
  phaseGroundingSchema,
  tripPlanJsonSchema,
  tripPlanSchema,
} from "../contracts/schemas.js";
import {
  GroundingPort,
  GroundingSource,
  ImageGenerationPort,
  ImageGenerationResult,
  PhaseGroundingResult,
  StoredPersonaProfile,
  TripPhase,
  TripPlan,
  TripRequest,
} from "../domain/types.js";

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
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
        uri?: string;
        title?: string;
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

function extractGroundingSources(
  response: GenerateContentResponse,
): GroundingSource[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!chunks) {
    return [];
  }

  return chunks
    .map((chunk) => ({
      title: chunk.web?.title ?? chunk.title ?? "Gemini grounding source",
      uri: chunk.web?.uri ?? chunk.uri,
    }))
    .filter((chunk): chunk is GroundingSource => Boolean(chunk.uri));
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

function buildPersonaSummary(persona: StoredPersonaProfile): string {
  return [
    `Name: ${persona.name}`,
    `Traits: ${persona.traits.join(", ")}`,
    `Relationship to user: ${persona.relationship}`,
    `Tone style: ${persona.toneStyle}`,
  ].join("\n");
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
      throw new Error(`Gemini request failed: ${response.status} ${response.statusText}`);
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
    this.planningModel = options.planningModel ?? "gemini-2.5-flash";
    this.textModel = options.textModel ?? "gemini-2.5-flash";
  }

  async planTrip(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
  }): Promise<TripPlan> {
    const prompt = [
      "You are planning a realistic 3-5 day single-city trip for a travel-companion bot.",
      "Use Google Search grounding and return strict JSON only.",
      `Trip ID: ${input.tripId}`,
      `Origin city: ${input.request.originCity}`,
      `Destination city: ${input.request.destinationCity}`,
      input.request.startWindow
        ? `Preferred start window: ${input.request.startWindow}`
        : "Preferred start window: pick the next reasonable departure window.",
      `Persona:\n${buildPersonaSummary(input.persona)}`,
      "Return exactly these fields: tripId, days, transport, hotel, dailyAgenda, groundingSources, weatherSummary, recommendedPostingMoments.",
      "dailyAgenda must contain one entry per day, each with morning/afternoon/evening arrays.",
      "recommendedPostingMoments should only use planning, departing, arrival_checkin, day_exploration, returning, home_reflection.",
    ].join("\n");

    const response = await this.generateContent(this.planningModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: tripPlanJsonSchema,
        temperature: 0.3,
      },
    });

    const parsed = parseModelJson(
      extractText(response),
      tripPlanSchema,
      "Gemini trip plan",
    );
    if (parsed.groundingSources.length === 0) {
      parsed.groundingSources = extractGroundingSources(response);
    }
    return parsed;
  }

  async enrichPhase(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
  }): Promise<PhaseGroundingResult> {
    const agenda =
      input.phase === "day_exploration"
        ? input.plan.dailyAgenda.find((entry) => entry.day === input.day)
        : undefined;

    const prompt = [
      "You generate travel grounding payloads for a realistic companion bot.",
      "Use Google Search grounding and return strict JSON only.",
      `Trip ID: ${input.tripId}`,
      `Origin city: ${input.request.originCity}`,
      `Destination city: ${input.request.destinationCity}`,
      `Phase: ${input.phase}`,
      `Day: ${input.day}`,
      `Persona:\n${buildPersonaSummary(input.persona)}`,
      `Hotel: ${input.plan.hotel.name}, ${input.plan.hotel.district}`,
      `Weather summary so far: ${input.plan.weatherSummary}`,
      agenda ? `Planned agenda: ${JSON.stringify(agenda)}` : "Planned agenda: n/a",
      "Return exactly these fields: phase, day, locality, weatherSummary, transitSummary, venueSummary, photoBrief, sensoryHighlights, groundingSources.",
    ].join("\n");

    const response = await this.generateContent(this.textModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: phaseGroundingJsonSchema,
        temperature: 0.4,
      },
    });

    const parsed = parseModelJson(
      extractText(response),
      phaseGroundingSchema,
      "Gemini phase grounding",
    );
    if (parsed.groundingSources.length === 0) {
      parsed.groundingSources = extractGroundingSources(response);
    }
    return parsed;
  }

  async composeCaption(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
    grounding: PhaseGroundingResult;
  }): Promise<{ caption: string; provider: string }> {
    const prompt = [
      "Write one short first-person travel companion postcard in Chinese.",
      "Sound vivid and alive, like a real person texting a close user.",
      "Do not use hashtags, markdown, or bullet points.",
      "Keep it under 120 Chinese characters.",
      `Persona:\n${buildPersonaSummary(input.persona)}`,
      `Destination: ${input.request.destinationCity}`,
      `Phase: ${input.phase}, day ${input.day}`,
      `Grounding: ${JSON.stringify(input.grounding)}`,
    ].join("\n");

    const response = await this.generateContent(this.textModel, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
      },
    });

    return {
      caption: extractLikelyJson(extractText(response)).replace(/^"|"$/g, "").trim(),
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
    grounding: PhaseGroundingResult;
    prompt: string;
  }): Promise<ImageGenerationResult> {
    const imageBytes = await readFile(input.persona.referenceImageAsset);
    const mimeType = mimeTypeFromPath(input.persona.referenceImageAsset);
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: input.prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBytes.toString("base64"),
              },
            },
          ],
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
