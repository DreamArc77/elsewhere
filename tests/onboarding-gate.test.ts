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

    expect(message).toContain("/travel-companion setup");
    expect(message).not.toContain("/travel-companion model");
  });

  it("continues model setup when model wizard is already open", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({ hasPersona: true }),
      setupSession: setupSession("model"),
    });

    expect(message).toContain("/travel-companion model");
    expect(message).not.toContain("/travel-companion setup");
  });

  it("guides full first-time onboarding in two steps", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({}),
      setupSession: null,
    });

    expect(message).toContain("还没完成首次配置");
    expect(message).toContain("/travel-companion setup");
    expect(message).toContain("/travel-companion model");
  });

  it("guides setup first when persona is missing", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({ hasTextProvider: true, hasGeminiKey: true }),
      setupSession: null,
    });

    expect(message).toContain("Ta 的角色信息");
    expect(message).toContain("/travel-companion setup");
    expect(message).not.toContain("Ta 的资料已经有了");
  });

  it("guides model when only provider config is missing", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({ hasPersona: true, hasGeminiKey: true }),
      setupSession: null,
    });

    expect(message).toContain("文本模型配置");
    expect(message).toContain("Ta 的资料已经有了");
    expect(message).toContain("/travel-companion model");
  });

  it("guides model when only gemini key is missing", () => {
    const message = buildOnboardingGateMessage({
      binding,
      readiness: readiness({ hasPersona: true, hasTextProvider: true }),
      setupSession: null,
    });

    expect(message).toContain("planning / 生图通道配置");
    expect(message).toContain("/travel-companion model");
    expect(message).not.toContain("/travel-companion setup");
  });
});
