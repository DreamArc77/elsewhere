import { z } from "zod";

import { tripPhases } from "../domain/types.js";

export const groundingSourceSchema = z.object({
  title: z.string().min(1),
  uri: z.string().url(),
  snippet: z.string().min(1).optional(),
});

export const tripPlanSchema = z.object({
  tripId: z.string().min(1),
  days: z.number().int().min(3).max(5),
  transport: z.object({
    summary: z.string().min(1),
    departure: z.string().min(1),
    arrival: z.string().min(1),
    carrierHint: z.string().min(1).optional(),
  }),
  hotel: z.object({
    name: z.string().min(1),
    district: z.string().min(1),
    address: z.string().min(1).optional(),
    nightlyBudget: z.string().min(1).optional(),
  }),
  dailyAgenda: z
    .array(
      z.object({
        day: z.number().int().min(1),
        dateLabel: z.string().min(1),
        headline: z.string().min(1),
        morning: z.array(z.string().min(1)).min(1),
        afternoon: z.array(z.string().min(1)).min(1),
        evening: z.array(z.string().min(1)).min(1),
        notes: z.string().min(1),
      }),
    )
    .min(3)
    .max(5),
  groundingSources: z.array(groundingSourceSchema).min(1),
  weatherSummary: z.string().min(1),
  recommendedPostingMoments: z.array(z.enum(tripPhases)).min(1),
});

export const phaseGroundingSchema = z.object({
  phase: z.enum(tripPhases),
  day: z.number().int().min(0),
  locality: z.string().min(1),
  weatherSummary: z.string().min(1),
  transitSummary: z.string().min(1),
  venueSummary: z.string().min(1),
  photoBrief: z.string().min(1),
  sensoryHighlights: z.array(z.string().min(1)).min(1),
  groundingSources: z.array(groundingSourceSchema).min(1),
});

export const imageGenerationResultSchema = z.object({
  mimeType: z.string().min(1),
  bytesBase64: z.string().min(1),
  provider: z.string().min(1),
  promptEcho: z.string().min(1).optional(),
});

export function parseModelJson<T>(
  rawText: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  const normalized = extractLikelyJson(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${String(error)}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `${label} failed schema validation: ${z.prettifyError(result.error)}`,
    );
  }

  return result.data;
}

export function extractLikelyJson(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return trimmed;
}

export const tripPlanJsonSchema = {
  type: "OBJECT",
  required: [
    "tripId",
    "days",
    "transport",
    "hotel",
    "dailyAgenda",
    "groundingSources",
    "weatherSummary",
    "recommendedPostingMoments",
  ],
  properties: {
    tripId: { type: "STRING" },
    days: { type: "INTEGER", minimum: 3, maximum: 5 },
    transport: {
      type: "OBJECT",
      required: ["summary", "departure", "arrival"],
      properties: {
        summary: { type: "STRING" },
        departure: { type: "STRING" },
        arrival: { type: "STRING" },
        carrierHint: { type: "STRING" },
      },
    },
    hotel: {
      type: "OBJECT",
      required: ["name", "district"],
      properties: {
        name: { type: "STRING" },
        district: { type: "STRING" },
        address: { type: "STRING" },
        nightlyBudget: { type: "STRING" },
      },
    },
    dailyAgenda: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: [
          "day",
          "dateLabel",
          "headline",
          "morning",
          "afternoon",
          "evening",
          "notes",
        ],
        properties: {
          day: { type: "INTEGER" },
          dateLabel: { type: "STRING" },
          headline: { type: "STRING" },
          morning: { type: "ARRAY", items: { type: "STRING" } },
          afternoon: { type: "ARRAY", items: { type: "STRING" } },
          evening: { type: "ARRAY", items: { type: "STRING" } },
          notes: { type: "STRING" },
        },
      },
    },
    groundingSources: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["title", "uri"],
        properties: {
          title: { type: "STRING" },
          uri: { type: "STRING" },
          snippet: { type: "STRING" },
        },
      },
    },
    weatherSummary: { type: "STRING" },
    recommendedPostingMoments: {
      type: "ARRAY",
      items: { type: "STRING", enum: [...tripPhases] },
    },
  },
};

export const phaseGroundingJsonSchema = {
  type: "OBJECT",
  required: [
    "phase",
    "day",
    "locality",
    "weatherSummary",
    "transitSummary",
    "venueSummary",
    "photoBrief",
    "sensoryHighlights",
    "groundingSources",
  ],
  properties: {
    phase: { type: "STRING", enum: [...tripPhases] },
    day: { type: "INTEGER" },
    locality: { type: "STRING" },
    weatherSummary: { type: "STRING" },
    transitSummary: { type: "STRING" },
    venueSummary: { type: "STRING" },
    photoBrief: { type: "STRING" },
    sensoryHighlights: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    groundingSources: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["title", "uri"],
        properties: {
          title: { type: "STRING" },
          uri: { type: "STRING" },
          snippet: { type: "STRING" },
        },
      },
    },
  },
};
