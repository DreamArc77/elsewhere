import { randomUUID } from "node:crypto";

import {
  ConversationBindingRecord,
  SetupSession,
  SetupSessionDraft,
  StoredPersonaProfile,
  TravelCompanionGlobalConfig,
  TravelCompanionTextProviderKind,
} from "../domain/types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export interface OnboardingReadiness {
  hasPersona: boolean;
  hasTextProvider: boolean;
  hasGeminiKey: boolean;
  isComplete: boolean;
}

export function evaluateOnboardingReadiness(input: {
  binding: ConversationBindingRecord;
  config: TravelCompanionGlobalConfig;
  fallbackGeminiApiKey?: string;
}): OnboardingReadiness {
  const hasPersona = Boolean(input.binding.defaultPersonaId);
  const hasTextProvider = Boolean(input.config.textProvider?.kind);
  const hasGeminiKey = Boolean(
    input.config.geminiApiKey?.trim() || input.fallbackGeminiApiKey?.trim(),
  );

  return {
    hasPersona,
    hasTextProvider,
    hasGeminiKey,
    isComplete: hasPersona && hasTextProvider && hasGeminiKey,
  };
}

export function createSetupSession(
  existing?: SetupSessionDraft,
): SetupSession {
  const timestamp = nowIso();
  return {
    step: "name",
    awaitingReferencePhoto: false,
    draft: existing ?? {},
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeTraitsInput(value: string): string[] {
  return value
    .split(/[,\n，]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseTextProviderChoice(
  value: string,
): TravelCompanionTextProviderKind | null {
  const normalized = value.trim().toLowerCase();
  if (
    ["1", "default", "host-default", "host", "openclaw"].includes(normalized)
  ) {
    return "host-default";
  }
  if (["2", "gemini", "google"].includes(normalized)) {
    return "gemini";
  }
  if (
    ["3", "openai", "openai-compatible", "compatible"].includes(normalized)
  ) {
    return "openai-compatible";
  }
  return null;
}

export function advanceSetupSessionWithText(input: {
  session: SetupSession;
  text: string;
  globalConfig: TravelCompanionGlobalConfig;
  fallbackGeminiApiKey?: string;
}): {
  session: SetupSession;
  completed: boolean;
  configPatch?: Partial<TravelCompanionGlobalConfig>;
} {
  const text = input.text.trim();
  const updatedAt = nowIso();
  const hasGeminiKeyAlready = Boolean(
    input.globalConfig.geminiApiKey?.trim() ||
      input.fallbackGeminiApiKey?.trim(),
  );

  const next: SetupSession = {
    ...input.session,
    draft: { ...input.session.draft },
    updatedAt,
  };

  switch (input.session.step) {
    case "name":
      next.draft.name = text;
      next.step = "home_city";
      break;
    case "home_city":
      next.draft.homeCity = text;
      next.step = "traits";
      break;
    case "traits":
      next.draft.traits = normalizeTraitsInput(text);
      next.step = "relationship";
      break;
    case "relationship":
      next.draft.relationship = text;
      next.step = "tone";
      break;
    case "tone":
      next.draft.toneStyle = text;
      next.step = "reference_photo";
      next.awaitingReferencePhoto = true;
      break;
    case "text_provider": {
      const choice = parseTextProviderChoice(text);
      if (!choice) {
        throw new Error(
          "没看懂这个模型选项。回 1/2/3，或者直接回复 default / gemini / openai-compatible。",
        );
      }
      next.draft.textProviderKind = choice;
      if (choice === "openai-compatible") {
        next.step = "openai_base_url";
      } else if (hasGeminiKeyAlready) {
        next.step = "complete";
        return {
          session: next,
          completed: true,
          configPatch: {
            textProvider: { kind: choice },
          },
        };
      } else {
        next.step = "gemini_api_key";
      }
      return {
        session: next,
        completed: false,
        configPatch: {
          textProvider: { kind: choice },
        },
      };
    }
    case "openai_base_url":
      next.draft.openaiBaseUrl = text;
      next.step = "openai_api_key";
      break;
    case "openai_api_key":
      next.draft.openaiApiKey = text;
      next.step = "openai_model";
      break;
    case "openai_model":
      next.draft.openaiModel = text;
      if (hasGeminiKeyAlready) {
        next.step = "complete";
        return {
          session: next,
          completed: true,
          configPatch: {
            textProvider: {
              kind: "openai-compatible",
              baseUrl: next.draft.openaiBaseUrl,
              apiKey: next.draft.openaiApiKey,
              model: next.draft.openaiModel,
            },
          },
        };
      }
      next.step = "gemini_api_key";
      return {
        session: next,
        completed: false,
        configPatch: {
          textProvider: {
            kind: "openai-compatible",
            baseUrl: next.draft.openaiBaseUrl,
            apiKey: next.draft.openaiApiKey,
            model: next.draft.openaiModel,
          },
        },
      };
    case "gemini_api_key":
      next.step = "complete";
      return {
        session: next,
        completed: true,
        configPatch: {
          geminiApiKey: text,
          textProvider:
            next.draft.textProviderKind === "openai-compatible"
              ? {
                  kind: "openai-compatible",
                  baseUrl: next.draft.openaiBaseUrl,
                  apiKey: next.draft.openaiApiKey,
                  model: next.draft.openaiModel,
                }
              : { kind: next.draft.textProviderKind ?? "host-default" },
        },
      };
    default:
      throw new Error("当前 setup 步骤不接收文字输入。");
  }

  return {
    session: next,
    completed: false,
  };
}

export function advanceSetupSessionWithPhoto(input: {
  session: SetupSession;
  referenceImageAsset: string;
}): SetupSession {
  if (input.session.step !== "reference_photo") {
    throw new Error("当前 setup 步骤不在等待照片。");
  }

  return {
    ...input.session,
    awaitingReferencePhoto: false,
    step: "text_provider",
    updatedAt: nowIso(),
    draft: {
      ...input.session.draft,
      referenceImageAsset: input.referenceImageAsset,
    },
  };
}

export function renderSetupStepPrompt(session: SetupSession): string {
  switch (session.step) {
    case "name":
      return "先给 Ta 起个名字，直接回名字就行。";
    case "home_city":
      return "Ta 目前居住在哪个城市？直接回城市名就行。";
    case "traits":
      return "接下来给我几个 Ta 的性格关键词，用逗号分开就行。比如：温柔，黏人，爱撒娇。";
    case "relationship":
      return "你希望 Ta 和你是什么关系？直接用一句话回复就行。";
    case "tone":
      return "最后描述一下 Ta 平时说话的语气风格。";
    case "reference_photo":
      return "现在把 Ta 的参考照片发我一张。接下来你发来的下一张图片会被当作角色参考图。";
    case "text_provider":
      return [
        "文字模型怎么配？回复一个选项：",
        "1. default（使用当前 OpenClaw 默认模型）",
        "2. gemini",
        "3. openai-compatible",
      ].join("\n");
    case "openai_base_url":
      return "回复 OpenAI-compatible 的 base URL。";
    case "openai_api_key":
      return "回复这个 OpenAI-compatible provider 的 API key。";
    case "openai_model":
      return "回复要使用的模型名。";
    case "gemini_api_key":
      return [
        "还差 Gemini API key。",
        "planning 和生图都会共用这一个 key。",
        "Gemini key 获取链接：[Google AI Studio](https://aistudio.google.com/app/apikey)",
        "直接把 key 发我就行。",
      ].join("\n");
    case "complete":
      return "setup 已完成。";
  }
}

export function buildIdleGuideMessage(persona: StoredPersonaProfile): string {
  return `${persona.name} 已经准备好了。你可以直接回我一个旅行目的地，比如“东京”或“大理”，我就会帮你开始这趟旅行。`;
}

export function buildOnboardingGateMessage(input: {
  binding: ConversationBindingRecord;
  readiness: OnboardingReadiness;
  hasSetupSession: boolean;
}): string {
  if (input.hasSetupSession) {
    return "Ta 的 onboarding 还没完成。继续用 /travel-companion setup，然后按提示一步步回复就行。";
  }

  const missing: string[] = [];
  if (!input.readiness.hasPersona) {
    missing.push("Ta 的角色信息");
  }
  if (!input.readiness.hasTextProvider) {
    missing.push("文字模型配置");
  }
  if (!input.readiness.hasGeminiKey) {
    missing.push("Gemini key（planning 和生图共用）");
  }

  return [
    "这条会话已经进入 Ta 模式，但 onboarding 还没完成。",
    `还缺：${missing.join("、")}`,
    "先运行 /travel-companion setup，我会一步步带你配完。",
  ].join("\n");
}

export function createCompletedPersonaProfile(
  draft: SetupSessionDraft,
): StoredPersonaProfile {
  if (
    !draft.name ||
    !draft.homeCity ||
    !draft.traits?.length ||
    !draft.relationship ||
    !draft.toneStyle ||
    !draft.referenceImageAsset
  ) {
    throw new Error("setup 还没收集完整的人设信息。");
  }

  return {
    personaId: randomUUID(),
    name: draft.name,
    homeCity: draft.homeCity,
    traits: draft.traits,
    relationship: draft.relationship,
    toneStyle: draft.toneStyle,
    referenceImageAsset: draft.referenceImageAsset,
    createdAt: nowIso(),
  };
}
