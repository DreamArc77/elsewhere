import { describe, expect, it } from "vitest";

import {
  buildOnboardingGateMessage,
  type OnboardingReadiness,
} from "../src/openclaw-plugin/onboarding.js";
import type { ConversationBindingRecord, SetupSession } from "../src/domain/types.js";

const binding: ConversationBindingRecord = {
  key: "telegram::default::123::main",
  channel: "telegram",
  accountId: "default",
  target: "123",
  mode: "companion-exclusive",
};

function readiness(input: Partial<OnboardingReadiness>): OnboardingReadiness {
  return {
    hasPersona: false,
    hasTextProvider: false,
    hasGeminiKey: false,
    isComplete: false,
    ...input,
  };
}

function setupSession(kind: SetupSession["kind"]): SetupSession {
  return {
    kind,
    step: kind === "model" ? "text_provider" : "name",
    awaitingReferencePhoto: false,
    returnToReview: false,
    draft: {},
    startedAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z",
  };
}

describe("buildOnboardingGateMessage", () => {
  it("continues persona setup when persona wizard is already open", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({}),
      setupSession: setupSession("persona"),
    });

    expect(message).toContain("/elsewhere setup");
    expect(message).not.toContain("/elsewhere model");
  });

  it("continues model setup inside the setup flow when model wizard is already open", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({ hasPersona: true }),
      setupSession: setupSession("model"),
    });

    expect(message).toContain("/elsewhere setup");
    expect(message).toContain("配置模型");
  });

  it("guides first-time onboarding into setup first", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({}),
      setupSession: null,
    });

    expect(message).toContain("欢迎来到 elsewhere");
    expect(message).toContain("/elsewhere setup");
    expect(message).not.toContain("/elsewhere model");
  });

  it("reuses the same first-time gate when persona is missing", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({ hasTextProvider: true, hasGeminiKey: true }),
      setupSession: null,
    });

    expect(message).toContain("欢迎来到 elsewhere");
    expect(message).toContain("/elsewhere setup");
    expect(message).not.toContain("/elsewhere model");
  });

  it("reuses the same first-time gate when only provider config is missing", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({ hasPersona: true, hasGeminiKey: true }),
      setupSession: null,
    });

    expect(message).toContain("欢迎来到 elsewhere");
    expect(message).toContain("/elsewhere setup");
    expect(message).not.toContain("/elsewhere model");
  });

  it("reuses the same first-time gate when only gemini key is missing", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({ hasPersona: true, hasTextProvider: true }),
      setupSession: null,
    });

    expect(message).toContain("欢迎来到 elsewhere");
    expect(message).toContain("/elsewhere setup");
    expect(message).not.toContain("/elsewhere model");
  });
});
