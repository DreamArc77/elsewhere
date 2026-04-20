import { describe, expect, it } from "vitest";

import {
  advanceSetupSessionWithText,
  buildModelSetupDraft,
  createSetupSession,
} from "../src/openclaw-plugin/onboarding.js";

describe("model setup flow", () => {
  it("routes model setup to gemini provider selection when no planning/image provider is configured", () => {
    const result = advanceSetupSessionWithText({
      session: createSetupSession({ kind: "model" }),
      text: "1",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
      },
    });

    expect(result.completed).toBe(false);
    expect(result.session.step).toBe("gemini_provider");
    expect(result.configPatch).toEqual({
      textProvider: { kind: "host-default" },
    });
  });

  it("stores openrouter as the planning/image provider", () => {
    const providerStep = advanceSetupSessionWithText({
      session: createSetupSession({
        kind: "model",
        draft: { textProviderKind: "host-default" },
        step: "gemini_provider",
      }),
      text: "2",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
      },
    });

    expect(providerStep.session.step).toBe("openrouter_api_key");

    const completeStep = advanceSetupSessionWithText({
      session: providerStep.session,
      text: "sk-or-v1-test",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
      },
    });

    expect(completeStep.completed).toBe(true);
    expect(completeStep.configPatch).toMatchObject({
      textProvider: { kind: "host-default" },
      geminiProvider: {
        kind: "openrouter",
        apiKey: "sk-or-v1-test",
      },
    });
  });

  it("hydrates model setup draft from the new gemini provider config", () => {
    const draft = buildModelSetupDraft({
      updatedAt: new Date().toISOString(),
      textProvider: {
        kind: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "oa-key",
        model: "gpt-test",
      },
      geminiProvider: {
        kind: "openrouter",
        apiKey: "sk-or-v1-test",
      },
    });

    expect(draft.textProviderKind).toBe("openai-compatible");
    expect(draft.openaiBaseUrl).toBe("https://example.com/v1");
    expect(draft.geminiProviderKind).toBe("openrouter");
    expect(draft.geminiProviderApiKey).toBe("sk-or-v1-test");
  });

  it("forces /model-style setup to reconfigure gemini even when a provider already exists", () => {
    const result = advanceSetupSessionWithText({
      session: createSetupSession({
        kind: "model",
        forceGeminiReconfigure: true,
        draft: {
          textProviderKind: "host-default",
          geminiProviderKind: "openrouter",
          geminiProviderApiKey: "existing-key",
        },
      }),
      text: "1",
      globalConfig: {
        updatedAt: new Date(0).toISOString(),
        geminiProvider: {
          kind: "openrouter",
          apiKey: "existing-key",
        },
      },
    });

    expect(result.completed).toBe(false);
    expect(result.session.step).toBe("gemini_provider");
    expect(result.configPatch).toEqual({
      textProvider: { kind: "host-default" },
    });
  });
});
