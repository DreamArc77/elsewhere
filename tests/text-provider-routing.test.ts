import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/agent-runtime", () => ({
  prepareSimpleCompletionModel: vi.fn(),
  completeWithPreparedSimpleCompletionModel: vi.fn(),
  extractAssistantText: vi.fn(),
}));

import {
  completeWithPreparedSimpleCompletionModel,
  extractAssistantText,
  prepareSimpleCompletionModel,
} from "openclaw/plugin-sdk/agent-runtime";

import { resolveAgentState } from "../src/domain/business-situation.js";
import { GeminiRestGroundingAdapter } from "../src/infrastructure/gemini-rest-adapters.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("text provider routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes reply generation through openai-compatible provider when configured", async () => {
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

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  segments: ["好呀，晚点我再跟你说。"],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new GeminiRestGroundingAdapter({
      apiKey: "unused-for-openai-compatible",
      textProviderResolver: async () => ({
        kind: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "openai-key",
        model: "gpt-test",
      }),
      fetchImpl,
    });

    const resolvedState = resolveAgentState({
      activeTrip: trip,
      now: new Date(trip.createdAt),
      persona,
    });

    const reply = await adapter.composeCompanionReply({
      conversationKey: "telegram::1::1::main",
      persona,
      pendingUserMessages: [
        {
          messageId: "m1",
          content: "你什么时候出发呀？",
          receivedAt: new Date().toISOString(),
        },
      ],
      recentTurns: [],
      latestPostcardPhoto: undefined,
      activeTrip: trip,
      resolvedState,
      destinationLoopContext: {
        awaitingDestination: false,
        idleEnteredAt: null,
        idleGuideSentAt: null,
        pendingDestinationCandidate: null,
      },
      now: new Date().toISOString(),
    });

    expect(reply.segments).toEqual(["好呀，晚点我再跟你说。"]);
    expect(reply.provider).toBe("openai-compatible:gpt-test");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://example.com/v1/chat/completions");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer openai-key",
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-test",
      response_format: { type: "json_object" },
    });
  });

  it("routes caption generation through host-default provider when configured", async () => {
    vi.mocked(prepareSimpleCompletionModel).mockResolvedValue({
      model: {} as never,
      auth: {
        apiKey: "host-key",
        source: "test",
        mode: "api-key",
      },
    });
    vi.mocked(completeWithPreparedSimpleCompletionModel).mockResolvedValue(
      {} as never,
    );
    vi.mocked(extractAssistantText).mockReturnValue("只是很普通的一张出发前随拍。");

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
      throw new Error("Expected trip timeline to include a postcard step context.");
    }

    const adapter = new GeminiRestGroundingAdapter({
      apiKey: "unused-for-host-default",
      textProviderResolver: async () => ({ kind: "host-default" }),
      runtime: {
        config: {
          loadConfig: () => ({}) as never,
        },
        agent: {
          defaults: {
            provider: "openai",
            model: "gpt-5.4-mini",
          },
        },
      } as never,
    });

    const resolvedState = resolveAgentState({
      activeTrip: trip,
      now: new Date(step.timing.startUtc),
      persona,
    });

    const caption = await adapter.composeCaption({
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
        locality: "自己的房间中",
        weatherSummary: "Sunny, 10-22°C",
        transitSummary: "Preparing to depart from Hong Kong",
        venueSummary: "Packing at home before departure.",
        photoBrief: "A low-stakes packing snapshot before leaving.",
        sensoryHighlights: ["open suitcase", "window light"],
        groundingSources: [],
      },
      resolvedState,
      imagePrompt: "普通的出发前随手拍",
    });

    expect(caption.caption).toBe("只是很普通的一张出发前随拍。");
    expect(caption.provider).toBe("openai:gpt-5.4-mini");
    expect(prepareSimpleCompletionModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        modelId: "gpt-5.4-mini",
      }),
    );
    expect(completeWithPreparedSimpleCompletionModel).toHaveBeenCalledOnce();
  });

  it("prefers configured host default model ref when config overrides runtime defaults", async () => {
    vi.mocked(prepareSimpleCompletionModel).mockResolvedValue({
      model: {} as never,
      auth: {
        apiKey: "host-key",
        source: "test",
        mode: "api-key",
      },
    });
    vi.mocked(completeWithPreparedSimpleCompletionModel).mockResolvedValue(
      {} as never,
    );
    vi.mocked(extractAssistantText).mockReturnValue("ok");

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
      throw new Error("Expected trip timeline to include a postcard step context.");
    }

    const adapter = new GeminiRestGroundingAdapter({
      apiKey: "unused-for-host-default",
      textProviderResolver: async () => ({ kind: "host-default" }),
      runtime: {
        config: {
          loadConfig: () =>
            ({
              agents: {
                defaults: {
                  model: {
                    primary: "openai/gpt-5.4",
                  },
                },
              },
            }) as never,
        },
        agent: {
          defaults: {
            provider: "openai",
            model: "gpt-5.4-mini",
          },
        },
      } as never,
    });

    const resolvedState = resolveAgentState({
      activeTrip: trip,
      now: new Date(step.timing.startUtc),
      persona,
    });

    await adapter.composeCaption({
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
        locality: "鑷繁鐨勬埧闂翠腑",
        weatherSummary: "Sunny, 10-22掳C",
        transitSummary: "Preparing to depart from Hong Kong",
        venueSummary: "Packing at home before departure.",
        photoBrief: "A low-stakes packing snapshot before leaving.",
        sensoryHighlights: ["open suitcase", "window light"],
        groundingSources: [],
      },
      resolvedState,
      imagePrompt: "鏅€氱殑鍑哄彂鍓嶉殢鎵嬫媿",
    });

    expect(prepareSimpleCompletionModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        modelId: "gpt-5.4",
      }),
    );
  });
});
