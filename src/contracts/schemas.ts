import { z } from "zod";

export const groundingSourceSchema = z.object({
  title: z.string().min(1),
  uri: z.string().url(),
  snippet: z.string().min(1).optional(),
});

export const itineraryActivitySchema = z.object({
  time_slot: z.string().min(1),
  location: z.string().min(1),
  address: z.string().min(1),
  type: z.enum([
    "sightseeing",
    "food",
    "transport",
    "shopping",
    "accommodation",
  ]),
  description: z.string().min(1),
  arrival_context: z.object({
    from_location: z.string().min(1),
    transport_mode: z.enum(["airplane", "train", "car", "subway", "walk"]),
    duration_minutes: z.number().int().min(0).max(600),
  }),
  route: z
    .object({
      from_location: z.string().min(1),
      to_location: z.string().min(1),
      transport_mode: z.enum(["airplane", "train", "car", "subway", "walk"]),
    })
    .optional(),
  real_time_info: z.object({
    live_update: z.string().min(1),
  }),
});

export const dailyItinerarySchema = z.object({
  day: z.number().int().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  weather_forecast: z.string().min(1),
  theme: z.string().min(1),
  activities: z.array(itineraryActivitySchema).min(1),
});

export const tripPlanSchema = z.object({
  tripId: z.string().min(1),
  metadata: z.object({
    origin: z.string().min(1),
    destination: z.string().min(1),
    days: z.number().int().min(1).max(14),
  }),
  transportation: z.object({
    departure: z.object({
      type: z.enum(["flight", "train"]),
      transport_mode: z.enum(["airplane", "train"]),
      identifier: z.string().min(1),
      operator: z.string().min(1),
      departure: z.object({
        station: z.string().min(1),
        time: z.string().min(1),
      }),
      arrival: z.object({
        station: z.string().min(1),
        time: z.string().min(1),
      }),
    }),
    return: z.object({
      type: z.enum(["flight", "train"]),
      transport_mode: z.enum(["airplane", "train"]),
      identifier: z.string().min(1),
      operator: z.string().min(1),
      departure: z.object({
        station: z.string().min(1),
        time: z.string().min(1),
      }),
      arrival: z.object({
        station: z.string().min(1),
        time: z.string().min(1),
      }),
    }),
  }),
  daily_itinerary: z.array(dailyItinerarySchema).min(1),
});

export const imageGenerationResultSchema = z.object({
  mimeType: z.string().min(1),
  bytesBase64: z.string().min(1),
  provider: z.string().min(1),
  promptEcho: z.string().min(1).optional(),
  imageSummary: z.string().min(1).optional(),
});

export const companionReplyPlanSchema = z.object({
  segments: z.array(z.string().min(1)).min(1).max(5),
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
  required: ["tripId", "metadata", "transportation", "daily_itinerary"],
  properties: {
    tripId: { type: "STRING" },
    metadata: {
      type: "OBJECT",
      required: ["origin", "destination", "days"],
      properties: {
        origin: { type: "STRING" },
        destination: { type: "STRING" },
        days: { type: "INTEGER", minimum: 1, maximum: 14 },
      },
    },
    transportation: {
      type: "OBJECT",
      required: ["departure", "return"],
      properties: {
        departure: transportLegJsonSchema(),
        return: transportLegJsonSchema(),
      },
    },
    daily_itinerary: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["day", "date", "weather_forecast", "theme", "activities"],
        properties: {
          day: { type: "INTEGER" },
          date: { type: "STRING" },
          weather_forecast: { type: "STRING" },
          theme: { type: "STRING" },
          activities: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              required: [
                "time_slot",
                "location",
                "address",
                "type",
                "description",
                "arrival_context",
                "real_time_info",
              ],
              properties: {
                time_slot: { type: "STRING" },
                location: { type: "STRING" },
                address: { type: "STRING" },
                type: {
                  type: "STRING",
                  enum: [
                    "sightseeing",
                    "food",
                    "transport",
                    "shopping",
                    "accommodation",
                  ],
                },
                description: { type: "STRING" },
                arrival_context: {
                  type: "OBJECT",
                  required: [
                    "from_location",
                    "transport_mode",
                    "duration_minutes",
                  ],
                  properties: {
                    from_location: { type: "STRING" },
                    transport_mode: {
                      type: "STRING",
                      enum: ["airplane", "train", "car", "subway", "walk"],
                    },
                    duration_minutes: { type: "INTEGER", minimum: 0, maximum: 600 },
                  },
                },
                route: {
                  type: "OBJECT",
                  required: [
                    "from_location",
                    "to_location",
                    "transport_mode",
                  ],
                  properties: {
                    from_location: { type: "STRING" },
                    to_location: { type: "STRING" },
                    transport_mode: {
                      type: "STRING",
                      enum: ["airplane", "train", "car", "subway", "walk"],
                    },
                  },
                },
                real_time_info: {
                  type: "OBJECT",
                  required: ["live_update"],
                  properties: {
                    live_update: { type: "STRING" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const companionReplyPlanJsonSchema = {
  type: "OBJECT",
  required: ["segments"],
  properties: {
    segments: {
      type: "ARRAY",
      items: {
        type: "STRING",
      },
    },
  },
};

function transportLegJsonSchema() {
  return {
    type: "OBJECT",
    required: [
      "type",
      "transport_mode",
      "identifier",
      "operator",
      "departure",
      "arrival",
    ],
    properties: {
      type: { type: "STRING", enum: ["flight", "train"] },
      transport_mode: { type: "STRING", enum: ["airplane", "train"] },
      identifier: { type: "STRING" },
      operator: { type: "STRING" },
      departure: {
        type: "OBJECT",
        required: ["station", "time"],
        properties: {
          station: { type: "STRING" },
          time: { type: "STRING" },
        },
      },
      arrival: {
        type: "OBJECT",
        required: ["station", "time"],
        properties: {
          station: { type: "STRING" },
          time: { type: "STRING" },
        },
      },
    },
  };
}
