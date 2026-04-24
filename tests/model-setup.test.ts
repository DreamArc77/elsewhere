import { describe, expect, it } from "vitest";

import {
  advanceSetupSessionWithText,
  buildModelSetupDraft,
  createSetupSession,
} from "../src/openclaw-plugin/onboarding.js";

describe("model setup flow", () => {
  it("routes model setup to planning/image family selection when no provider is configured", () => {
    const result = advanceSetupSessionWithText({
      session: createSetupSession({ kind: "model" }),
      text: "1",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
      },
    });

    expect(result.completed).toBe(false);
    expect(result.session.step).toBe("planning_image_family");
    expect(result.configPatch).toEqual({
      textProvider: { kind: "host-default" },
    });
  });

  it("stores gemini + openrouter as the planning/image provider", () => {
    const familyStep = advanceSetupSessionWithText({
      session: createSetupSession({
        kind: "model",
        draft: { textProviderKind: "host-default" },
        step: "planning_image_family",
      }),
      text: "1",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
      },
    });

    expect(familyStep.session.step).toBe("planning_image_channel");

    const channelStep = advanceSetupSessionWithText({
      session: familyStep.session,
      text: "2",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
      },
    });

    expect(channelStep.session.step).toBe("planning_image_api_key");

    const completeStep = advanceSetupSessionWithText({
      session: channelStep.session,
      text: "sk-or-v1-test",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
      },
    });

    expect(completeStep.completed).toBe(true);
    expect(completeStep.configPatch).toMatchObject({
      textProvider: { kind: "host-default" },
      planningImageProvider: {
        kind: "gemini-openrouter",
        family: "gemini",
        channel: "openrouter",
        apiKey: "sk-or-v1-test",
      },
    });
  });

  it("hydrates model setup draft from the planning/image provider config", () => {
    const draft = buildModelSetupDraft({
      updatedAt: new Date().toISOString(),
      textProvider: {
        kind: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "oa-key",
        model: "gpt-test",
      },
      planningImageProvider: {
        kind: "gemini-openrouter",
        family: "gemini",
        channel: "openrouter",
        apiKey: "sk-or-v1-test",
      },
    });

    expect(draft.textProviderKind).toBe("openai-compatible");
    expect(draft.openaiBaseUrl).toBe("https://example.com/v1");
    expect(draft.planningImageFamily).toBe("gemini");
    expect(draft.planningImageChannel).toBe("openrouter");
    expect(draft.planningImageProviderKind).toBe("gemini-openrouter");
    expect(draft.planningImageApiKey).toBe("sk-or-v1-test");
  });

  it("forces /model-style setup to reconfigure planning/image provider even when one already exists", () => {
    const result = advanceSetupSessionWithText({
      session: createSetupSession({
        kind: "model",
        forceGeminiReconfigure: true,
        draft: {
          textProviderKind: "host-default",
          planningImageFamily: "gemini",
          planningImageChannel: "openrouter",
          planningImageProviderKind: "gemini-openrouter",
          planningImageApiKey: "existing-key",
        },
      }),
      text: "1",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
        planningImageProvider: {
          kind: "gemini-openrouter",
          family: "gemini",
          channel: "openrouter",
          apiKey: "existing-key",
        },
      },
    });

    expect(result.completed).toBe(false);
    expect(result.session.step).toBe("planning_image_family");
    expect(result.configPatch).toEqual({
      textProvider: { kind: "host-default" },
    });
  });
});
