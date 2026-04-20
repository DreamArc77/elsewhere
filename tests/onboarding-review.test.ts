import { describe, expect, it } from "vitest";

import { renderSetupStepPrompt } from "../src/openclaw-plugin/onboarding.js";
import type { SetupSession } from "../src/domain/types.js";

function buildPersonaReviewSession(
  input?: Partial<SetupSession>,
): SetupSession {
  return {
    kind: "persona",
    step: "persona_review",
    awaitingReferencePhoto: false,
    returnToReview: false,
    draft: {
      name: "小美",
      originCity: "东京",
      traits: ["地雷系", "敏感", "黏人"],
      toneStyle: "病娇",
      relationship: "暧昧对象",
      userAddressing: "哥哥",
    },
    startedAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...input,
  };
}

describe("renderSetupStepPrompt persona review", () => {
  it("shows summary fields without conflicting numeric prefixes", () => {
    const message = renderSetupStepPrompt(
      buildPersonaReviewSession(),
      "zh-CN",
    );

    expect(message).toContain("当前资料如下：");
    expect(message).toContain("名字：小美");
    expect(message).toContain("旅伴居住的城市：东京");
    expect(message).toContain("1. 确认并继续处理参考图");
    expect(message).not.toContain("1. 名字");
    expect(message).not.toContain("2. 旅伴居住的城市");
  });

  it("uses the edit confirm copy when editing an existing persona", () => {
    const message = renderSetupStepPrompt(
      buildPersonaReviewSession({
        personaTargetId: "persona-1",
      }),
      "zh-CN",
    );

    expect(message).toContain("1. 确认并继续处理参考图");
    expect(message).toContain("8. 取消本次修改");
  });
});
