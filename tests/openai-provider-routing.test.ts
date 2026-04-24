import { describe, expect, it, vi } from "vitest";

import {
  GeminiRestGroundingAdapter,
  GeminiRestImageAdapter,
} from "../src/infrastructure/gemini-rest-adapters.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("openai provider routing", () => {
  it("routes trip planning through direct OpenAI when configured", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  tripId: "trip-openai-1",
                  metadata: {
                    origin: "Hong Kong",
                    destination: "Tokyo",
                    days: 2,
                  },
                  transportation: {
                    departure: {
                      type: "flight",
                      transport_mode: "airplane",
                      identifier: "HX600",
                      operator: "Hong Kong Airlines",
                      departure: {
                        station: "Hong Kong International Airport",
                        time: "09:00",
                      },
                      arrival: {
                        station: "Haneda Airport",
                        time: "14:00",
                      },
                    },
                    return: {
                      type: "flight",
                      transport_mode: "airplane",
                      identifier: "HX601",
                      operator: "Hong Kong Airlines",
                      departure: {
                        station: "Haneda Airport",
                        time: "19:00",
                      },
                      arrival: {
                        station: "Hong Kong International Airport",
                        time: "23:00",
                      },
                    },
                  },
                  daily_itinerary: [
                    {
                      day: 1,
                      date: "2026-04-20",
                      weather_forecast: "Sunny, 18C - 24C",
                      theme: "arrival",
                      activities: [
                        {
                          time_slot: "15:00 - 17:00",
                          location: "Shinjuku",
                          address: "Tokyo",
                          type: "sightseeing",
                          description: "Walk around Shinjuku.",
                          arrival_context: {
                            from_location: "Haneda Airport",
                            transport_mode: "train",
                            duration_minutes: 45,
                          },
                          route: null,
                          real_time_info: {
                            live_update: "Normal crowds.",
                          },
                        },
                      ],
                    },
                    {
                      day: 2,
                      date: "2026-04-21",
                      weather_forecast: "Cloudy, 16C - 22C",
                      theme: "return",
                      activities: [
                        {
                          time_slot: "10:00 - 12:00",
                          location: "Asakusa",
                          address: "Tokyo",
                          type: "sightseeing",
                          description: "Visit Asakusa.",
                          arrival_context: {
                            from_location: "Hotel",
                            transport_mode: "subway",
                            duration_minutes: 20,
                          },
                          route: null,
                          real_time_info: {
                            live_update: "Morning is quieter.",
                          },
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new GeminiRestGroundingAdapter({
      geminiProviderResolver: async () => ({
        kind: "openai-direct",
        family: "openai",
        channel: "native",
        apiKey: "sk-openai-test",
      }),
      fetchImpl,
    });

    const plan = await adapter.planTrip({
      tripId: "trip-openai-1",
      persona: {
        personaId: "persona-1",
        createdAt: new Date().toISOString(),
        name: "Aki",
        originCity: "Hong Kong",
        traits: ["gentle"],
        toneStyle: "soft",
        relationship: "companion",
        userAddressing: "你",
        referenceImageAsset: "/tmp/ref.png",
      },
      request: {
        personaId: "persona-1",
        originCity: "Hong Kong",
        destinationCity: "Tokyo",
      },
    });

    expect(plan.metadata.destination).toBe("Tokyo");
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer sk-openai-test",
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-5.4",
      response_format: {
        type: "json_schema",
      },
    });
  });

  it("routes trip planning through OpenRouter using OpenAI models when configured", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          model: "openai/gpt-5.4",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  tripId: "trip-openrouter-openai-1",
                  metadata: {
                    origin: "Hong Kong",
                    destination: "Tokyo",
                    days: 2,
                  },
                  transportation: {
                    departure: {
                      type: "flight",
                      transport_mode: "airplane",
                      identifier: "HX600",
                      operator: "Hong Kong Airlines",
                      departure: {
                        station: "Hong Kong International Airport",
                        time: "09:00",
                      },
                      arrival: {
                        station: "Haneda Airport",
                        time: "14:00",
                      },
                    },
                    return: {
                      type: "flight",
                      transport_mode: "airplane",
                      identifier: "HX601",
                      operator: "Hong Kong Airlines",
                      departure: {
                        station: "Haneda Airport",
                        time: "19:00",
                      },
                      arrival: {
                        station: "Hong Kong International Airport",
                        time: "23:00",
                      },
                    },
                  },
                  daily_itinerary: [
                    {
                      day: 1,
                      date: "2026-04-20",
                      weather_forecast: "Sunny, 18C - 24C",
                      theme: "arrival",
                      activities: [
                        {
                          time_slot: "15:00 - 17:00",
                          location: "Shinjuku",
                          address: "Tokyo",
                          type: "sightseeing",
                          description: "Walk around Shinjuku.",
                          arrival_context: {
                            from_location: "Haneda Airport",
                            transport_mode: "train",
                            duration_minutes: 45,
                          },
                          real_time_info: {
                            live_update: "Normal crowds.",
                          },
                        },
                      ],
                    },
                    {
                      day: 2,
                      date: "2026-04-21",
                      weather_forecast: "Cloudy, 16C - 22C",
                      theme: "return",
                      activities: [
                        {
                          time_slot: "10:00 - 12:00",
                          location: "Asakusa",
                          address: "Tokyo",
                          type: "sightseeing",
                          description: "Visit Asakusa.",
                          arrival_context: {
                            from_location: "Hotel",
                            transport_mode: "subway",
                            duration_minutes: 20,
                          },
                          real_time_info: {
                            live_update: "Morning is quieter.",
                          },
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new GeminiRestGroundingAdapter({
      geminiProviderResolver: async () => ({
        kind: "openai-openrouter",
        family: "openai",
        channel: "openrouter",
        apiKey: "sk-or-v1-test",
      }),
      fetchImpl,
    });

    const plan = await adapter.planTrip({
      tripId: "trip-openrouter-openai-1",
      persona: {
        personaId: "persona-1",
        createdAt: new Date().toISOString(),
        name: "Aki",
        originCity: "Hong Kong",
        traits: ["gentle"],
        toneStyle: "soft",
        relationship: "companion",
        userAddressing: "你",
        referenceImageAsset: "/tmp/ref.png",
      },
      request: {
        personaId: "persona-1",
        originCity: "Hong Kong",
        destinationCity: "Tokyo",
      },
    });

    expect(plan.metadata.destination).toBe("Tokyo");
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "openai/gpt-5.4",
      response_format: {
        type: "json_schema",
      },
    });
  });

  it("routes snapshot image generation through direct OpenAI and summarizes the image", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Aki",
      homeCity: "Hong Kong",
      traits: ["gentle"],
      relationship: "travel companion",
      toneStyle: "soft",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });
    const step = trip.timeline.find((item) => item.context)?.context;
    if (!step) {
      throw new Error("Expected a postcard step context.");
    }

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: "aGVsbG8=" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"scene":"hotel desk","otherPeopleVisible":"none","notableDetails":["city lights"]}',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const adapter = new GeminiRestImageAdapter({
      geminiProviderResolver: async () => ({
        kind: "openai-direct",
        family: "openai",
        channel: "native",
        apiKey: "sk-openai-test",
      }),
      fetchImpl,
    });

    const result = await adapter.generateImage({
      tripId: trip.tripId,
      persona,
      request: trip.request,
      plan: trip.plan,
      phase: step.phase,
      day: step.day,
      stepContext: step,
      grounding: {
        phase: step.phase,
        day: step.day,
        locality: "Tokyo hotel",
        weatherSummary: "Cloudy",
        transitSummary: "Taxi to hotel",
        venueSummary: "Quiet hotel room",
        photoBrief: "A quiet room snapshot",
        sensoryHighlights: ["desk lamp"],
        groundingSources: [],
      },
      shotKind: "snapshot",
      usesReferenceImage: false,
      prompt: "Generate a quiet hotel snapshot.",
    });

    expect(result.bytesBase64).toBe("aGVsbG8=");
    expect(result.imageSummary).toContain('"scene":"hotel desk"');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [generationUrl, generationRequest] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(generationUrl).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(String(generationRequest.body))).toMatchObject({
      model: "gpt-image-2",
      size: "1024x1280",
    });
  });

  it("routes image generation through OpenRouter using OpenAI image models when configured", async () => {
    const runtime = await createTestRuntime();
    const persona = await runtime.service.createPersona({
      name: "Aki",
      homeCity: "Hong Kong",
      traits: ["gentle"],
      relationship: "travel companion",
      toneStyle: "soft",
      referenceImageAsset: runtime.referenceImagePath,
    });
    const trip = await runtime.service.startTrip({
      personaId: persona.personaId,
      originCity: "Hong Kong",
      destinationCity: "Tokyo",
    });
    const step = trip.timeline.find((item) => item.context)?.context;
    if (!step) {
      throw new Error("Expected a postcard step context.");
    }

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          model: "openai/gpt-5.4-image-2",
          choices: [
            {
              message: {
                content:
                  '{"scene":"hotel desk","otherPeopleVisible":"none","notableDetails":["city lights"]}',
                images: [
                  {
                    type: "image_url",
                    image_url: {
                      url: "data:image/png;base64,aGVsbG8=",
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new GeminiRestImageAdapter({
      geminiProviderResolver: async () => ({
        kind: "openai-openrouter",
        family: "openai",
        channel: "openrouter",
        apiKey: "sk-or-v1-test",
      }),
      fetchImpl,
    });

    const result = await adapter.generateImage({
      tripId: trip.tripId,
      persona,
      request: trip.request,
      plan: trip.plan,
      phase: step.phase,
      day: step.day,
      stepContext: step,
      grounding: {
        phase: step.phase,
        day: step.day,
        locality: "Tokyo hotel",
        weatherSummary: "Cloudy",
        transitSummary: "Taxi to hotel",
        venueSummary: "Quiet hotel room",
        photoBrief: "A quiet room snapshot",
        sensoryHighlights: ["desk lamp"],
        groundingSources: [],
      },
      shotKind: "snapshot",
      usesReferenceImage: false,
      prompt: "Generate a quiet hotel snapshot.",
    });

    expect(result.bytesBase64).toBe("aGVsbG8=");
    expect(result.imageSummary).toContain('"scene":"hotel desk"');
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "openai/gpt-5.4-image-2",
      modalities: ["image", "text"],
    });
  });
});
