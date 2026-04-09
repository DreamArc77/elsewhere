import { z } from "zod";

const forbiddenCompanionLanguage =
  /(\bwe\b|\byou\b|和你一起|见到你|找到你|找你|牵(着)?你|你陪我|你在我身边|陪我一起|一起旅行|一起去|如果你敢|背叛我|放开我的手|只属于我|占有|惩罚|报复)/iu;

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
  transport_memo: z.string().min(1),
  real_time_info: z.object({
    live_update: z.string().min(1),
  }),
});

export const dailyItinerarySchema = z.object({
  day: z.number().int().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  theme: z.string().min(1),
  activities: z.array(itineraryActivitySchema).min(1),
});

function validateThreeTwoOnePlan(
  data: z.infer<typeof tripPlanSchemaBase>,
  ctx: z.RefinementCtx,
): void {
  if (data.daily_itinerary.length !== data.metadata.days) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["daily_itinerary"],
      message: "daily_itinerary length must match metadata.days.",
    });
  }

  for (const entry of data.daily_itinerary) {
    if (entry.day < 1 || entry.day > data.metadata.days) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daily_itinerary", entry.day - 1, "day"],
        message: "Each itinerary day must stay within metadata.days.",
      });
    }

    const expectedDateIndex = entry.day - 1;
    const mirroredEntry = data.daily_itinerary[expectedDateIndex];
    if (mirroredEntry?.day !== entry.day) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daily_itinerary"],
        message: "daily_itinerary day values must be sequential and start from 1.",
      });
    }

    const coreCount = entry.activities.filter(
      (activity) =>
        activity.type === "sightseeing" || activity.type === "shopping",
    ).length;
    const foodCount = entry.activities.filter(
      (activity) => activity.type === "food",
    ).length;
    const lastActivity = entry.activities[entry.activities.length - 1];
    const isEdgeDay =
      entry.day === 1 || entry.day === data.metadata.days;

    if (lastActivity?.type !== "accommodation") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daily_itinerary", entry.day - 1, "activities"],
        message: "The last activity of each day must be accommodation.",
      });
    }

    if (foodCount < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daily_itinerary", entry.day - 1, "activities"],
        message: "Each day must contain at least 2 food activities.",
      });
    }

    if (!isEdgeDay && coreCount < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daily_itinerary", entry.day - 1, "activities"],
        message:
          "Non-edge days must contain at least 3 sightseeing or shopping activities.",
      });
    }

    const narrativeFields = [
      { path: ["theme"], value: entry.theme },
      ...entry.activities.flatMap((activity, activityIndex) => [
        {
          path: ["activities", activityIndex, "description"],
          value: activity.description,
        },
        {
          path: ["activities", activityIndex, "transport_memo"],
          value: activity.transport_memo,
        },
        {
          path: ["activities", activityIndex, "real_time_info", "live_update"],
          value: activity.real_time_info.live_update,
        },
      ]),
    ];

    for (const field of narrativeFields) {
      if (forbiddenCompanionLanguage.test(field.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["daily_itinerary", entry.day - 1, ...field.path],
          message:
            "Trip itinerary text must stay objective and must not imply the user is physically traveling together with the companion.",
        });
      }
    }
  }
}

const tripPlanSchemaBase = z.object({
  tripId: z.string().min(1),
  metadata: z.object({
    destination: z.string().min(1),
    days: z.number().int().min(3).max(5),
  }),
  transportation: z.object({
    outbound: z.object({
      type: z.enum(["flight", "train"]),
      identifier: z.string().min(1),
      airline_operator: z.string().min(1).optional(),
      departure: z.object({
        airport_station: z.string().min(1),
        time: z.string().min(1),
      }),
      arrival: z.object({
        airport_station: z.string().min(1),
        time: z.string().min(1),
      }),
    }),
    return: z.object({
      type: z.enum(["flight", "train"]),
      identifier: z.string().min(1),
      airline_operator: z.string().min(1).optional(),
      departure: z.object({
        airport_station: z.string().min(1),
        time: z.string().min(1),
      }),
      arrival: z.object({
        airport_station: z.string().min(1),
        time: z.string().min(1),
      }),
    }),
  }),
  search_summary: z.object({
    weather_forecast: z.string().min(1),
    major_events: z.array(z.string().min(1)),
  }),
  daily_itinerary: z.array(dailyItinerarySchema).min(3).max(5),
});

export const tripPlanSchema = tripPlanSchemaBase.superRefine(
  validateThreeTwoOnePlan,
);

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
  required: ["tripId", "metadata", "transportation", "search_summary", "daily_itinerary"],
  properties: {
    tripId: { type: "STRING" },
    metadata: {
      type: "OBJECT",
      required: ["destination", "days"],
      properties: {
        destination: { type: "STRING" },
        days: { type: "INTEGER", minimum: 3, maximum: 5 },
      },
    },
    transportation: {
      type: "OBJECT",
      required: ["outbound", "return"],
      properties: {
        outbound: transportLegJsonSchema(),
        return: transportLegJsonSchema(),
      },
    },
    search_summary: {
      type: "OBJECT",
      required: ["weather_forecast", "major_events"],
      properties: {
        weather_forecast: { type: "STRING" },
        major_events: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
      },
    },
    daily_itinerary: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["day", "date", "theme", "activities"],
        properties: {
          day: { type: "INTEGER" },
          date: { type: "STRING" },
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
                "transport_memo",
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
                transport_memo: { type: "STRING" },
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

function transportLegJsonSchema() {
  return {
    type: "OBJECT",
    required: ["type", "identifier", "departure", "arrival"],
    properties: {
      type: { type: "STRING", enum: ["flight", "train"] },
      identifier: { type: "STRING" },
      airline_operator: { type: "STRING" },
      departure: {
        type: "OBJECT",
        required: ["airport_station", "time"],
        properties: {
          airport_station: { type: "STRING" },
          time: { type: "STRING" },
        },
      },
      arrival: {
        type: "OBJECT",
        required: ["airport_station", "time"],
        properties: {
          airport_station: { type: "STRING" },
          time: { type: "STRING" },
        },
      },
    },
  };
}
