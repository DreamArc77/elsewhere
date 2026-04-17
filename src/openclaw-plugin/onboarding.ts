import { randomUUID } from "node:crypto";

import {
  ConversationBindingRecord,
  SetupSession,
  SetupSessionDraft,
  SetupSessionKind,
  StoredPersonaProfile,
  TravelCompanionGlobalConfig,
  TravelCompanionTextProviderKind,
} from "../domain/types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function displayValue(value: string | undefined): string {
  return value?.trim() ? value.trim() : "未设置";
}

function displayList(values: string[] | undefined): string {
  return values?.length ? values.join("、") : "未设置";
}

function isPersonaEditSession(session: SetupSession): boolean {
  return session.kind === "persona" && Boolean(session.personaTargetId);
}

function shouldKeepCurrent(text: string, session: SetupSession): boolean {
  return isPersonaEditSession(session) && text === "0";
}

function advancePersonaStep(
  session: SetupSession,
  nextStep:
    | "name"
    | "origin_city"
    | "traits"
    | "tone"
    | "relationship"
    | "user_addressing"
    | "persona_review",
): SetupSession["step"] {
  if (session.returnToReview && nextStep !== "persona_review") {
    return "persona_review";
  }

  return nextStep;
}

function buildPersonaSummary(session: SetupSession): string[] {
  return [
    `名字：${displayValue(session.draft.name)}`,
    `Ta 居住的城市：${displayValue(
      session.draft.originCity || session.draft.homeCity,
    )}`,
    `性格特征：${displayList(session.draft.traits)}`,
    `说话风格：${displayValue(session.draft.toneStyle)}`,
    `和你的关系：${displayValue(session.draft.relationship)}`,
    `对你的称呼：${displayValue(session.draft.userAddressing)}`,
  ];
}

function buildCurrentValuePrompt(input: {
  currentValue: string;
  body: string[];
}): string {
  return [
    `当前值：${input.currentValue}`,
    ...input.body,
    "回复新内容，或回复 0",
  ].join("\n");
}

function buildPersonaStepPrompt(session: SetupSession): string {
  const editing = isPersonaEditSession(session);

  switch (session.step) {
    case "persona_intro":
      return [
        "我们先把 Ta 建起来。",
        "",
        "接下来我会依次确认：",
        "1. 名字",
        "2. Ta 居住的城市",
        "3. 性格特征",
        "4. 说话风格",
        "5. 和你的关系",
        "6. 对你的称呼",
        "7. 参考图",
        "",
        "准备好了回复 1",
      ].join("\n");
    case "existing_persona_confirm":
      return [
        "当前已经有 Ta 的设定了。",
        "",
        "这个命令会用于修改或覆盖现有资料。",
        "回复：",
        "1. 继续修改",
        "2. 取消",
      ].join("\n");
    case "name":
      return editing
        ? buildCurrentValuePrompt({
            currentValue: displayValue(session.draft.name),
            body: ["Ta 叫什么？"],
          })
        : "Ta 叫什么？";
    case "origin_city":
      return editing
        ? buildCurrentValuePrompt({
            currentValue: displayValue(
              session.draft.originCity || session.draft.homeCity,
            ),
            body: ["Ta 目前居住在哪座城市？"],
          })
        : "Ta 目前居住在哪座城市？";
    case "traits":
      return editing
        ? buildCurrentValuePrompt({
            currentValue: displayList(session.draft.traits),
            body: [
              "用几个词描述一下 Ta 的性格特征。",
              "例如：地雷系、敏感、黏人",
            ],
          })
        : ["用几个词描述一下 Ta 的性格特征。", "例如：地雷系、敏感、黏人"].join(
            "\n",
          );
    case "tone":
      return editing
        ? buildCurrentValuePrompt({
            currentValue: displayValue(session.draft.toneStyle),
            body: [
              "Ta 平时说话是什么感觉？",
              "例如：病娇、撒娇、冷淡、元气",
            ],
          })
        : [
            "Ta 平时说话是什么感觉？",
            "例如：病娇、撒娇、冷淡、元气",
          ].join("\n");
    case "relationship":
      return editing
        ? buildCurrentValuePrompt({
            currentValue: displayValue(session.draft.relationship),
            body: [
              "Ta 和你是什么关系？",
              "例如：异地恋女友、暧昧对象、旅行搭子",
            ],
          })
        : [
            "Ta 和你是什么关系？",
            "例如：异地恋女友、暧昧对象、旅行搭子",
          ].join("\n");
    case "user_addressing":
      return editing
        ? buildCurrentValuePrompt({
            currentValue: displayValue(session.draft.userAddressing),
            body: [
              "Ta 平时怎么称呼你？",
              "例如：哥哥、宝宝、宝、名字里的称呼",
            ],
          })
        : [
            "Ta 平时怎么称呼你？",
            "例如：哥哥、宝宝、宝、名字里的称呼",
          ].join("\n");
    case "persona_review":
      return [
        "目前资料如下：",
        "",
        ...buildPersonaSummary(session),
        "",
        "回复：",
        "1. 确认并继续处理参考图",
        "2. 修改名字",
        "3. 修改 Ta 居住的城市",
        "4. 修改性格特征",
        "5. 修改说话风格",
        "6. 修改和你的关系",
        "7. 修改对你的称呼",
        `8. 取消本次${editing ? "修改" : "设置"}`,
      ].join("\n");
    case "reference_photo_choice":
      if (editing && session.draft.referenceImageAsset) {
        return [
          "当前已有参考图。",
          "",
          "回复：",
          "1. 上传一张新参考图",
          "2. 沿用当前参考图",
          "3. 返回资料确认",
        ].join("\n");
      }

      return [
        "最后一步，处理参考图。",
        "",
        "回复：",
        "1. 上传参考图",
        "2. 返回资料确认",
      ].join("\n");
    case "reference_photo":
      return "好，直接发一张图片就行。";
    case "complete":
      return editing ? "Ta 资料已更新。" : "Ta 创建完成。";
    default:
      return "继续完成 Ta 的资料。";
  }
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

export function buildPersonaSetupDraft(
  persona?: StoredPersonaProfile | null,
): SetupSessionDraft {
  if (!persona) {
    return {};
  }

  return {
    name: persona.name,
    originCity: persona.originCity || persona.homeCity,
    traits: [...persona.traits],
    toneStyle: persona.toneStyle,
    relationship: persona.relationship,
    userAddressing: persona.userAddressing,
    referenceImageAsset: persona.referenceImageAsset,
  };
}

export function buildModelSetupDraft(
  config: TravelCompanionGlobalConfig,
): SetupSessionDraft {
  return {
    textProviderKind: config.textProvider?.kind,
    openaiBaseUrl:
      config.textProvider?.kind === "openai-compatible"
        ? config.textProvider.baseUrl
        : undefined,
    openaiApiKey:
      config.textProvider?.kind === "openai-compatible"
        ? config.textProvider.apiKey
        : undefined,
    openaiModel:
      config.textProvider?.kind === "openai-compatible"
        ? config.textProvider.model
        : undefined,
  };
}

export function createSetupSession(input?: {
  kind?: SetupSessionKind;
  draft?: SetupSessionDraft;
  step?: SetupSession["step"];
  personaTargetId?: string;
}): SetupSession {
  const timestamp = nowIso();
  const kind = input?.kind ?? "persona";

  return {
    kind,
    personaTargetId: input?.personaTargetId,
    step:
      input?.step ?? (kind === "model" ? "text_provider" : "persona_intro"),
    awaitingReferencePhoto: false,
    returnToReview: false,
    draft: input?.draft ?? {},
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeTraitsInput(value: string): string[] {
  return value
    .split(/[,\n，、]/u)
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
  cancelled?: boolean;
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

  if (input.session.kind === "persona") {
    switch (input.session.step) {
      case "persona_intro":
        if (text !== "1") {
          throw new Error("准备好了就回复 1。");
        }
        next.step = "name";
        return { session: next, completed: false };
      case "existing_persona_confirm":
        if (text === "1") {
          next.step = "name";
          return { session: next, completed: false };
        }
        if (text === "2") {
          return { session: next, completed: false, cancelled: true };
        }
        throw new Error("请回复 1 继续修改，或回复 2 取消。");
      case "name":
        if (!shouldKeepCurrent(text, input.session)) {
          next.draft.name = text;
        }
        next.step = advancePersonaStep(input.session, "origin_city");
        next.returnToReview = false;
        return { session: next, completed: false };
      case "origin_city":
        if (!shouldKeepCurrent(text, input.session)) {
          next.draft.originCity = text;
        }
        next.step = advancePersonaStep(input.session, "traits");
        next.returnToReview = false;
        return { session: next, completed: false };
      case "traits":
        if (!shouldKeepCurrent(text, input.session)) {
          next.draft.traits = normalizeTraitsInput(text);
        }
        next.step = advancePersonaStep(input.session, "tone");
        next.returnToReview = false;
        return { session: next, completed: false };
      case "tone":
        if (!shouldKeepCurrent(text, input.session)) {
          next.draft.toneStyle = text;
        }
        next.step = advancePersonaStep(input.session, "relationship");
        next.returnToReview = false;
        return { session: next, completed: false };
      case "relationship":
        if (!shouldKeepCurrent(text, input.session)) {
          next.draft.relationship = text;
        }
        next.step = advancePersonaStep(input.session, "user_addressing");
        next.returnToReview = false;
        return { session: next, completed: false };
      case "user_addressing":
        if (shouldKeepCurrent(text, input.session) && !next.draft.userAddressing) {
          throw new Error("当前还没有设定 Ta 对你的称呼，这一项需要补一个。");
        }
        if (!shouldKeepCurrent(text, input.session)) {
          next.draft.userAddressing = text;
        }
        next.step = "persona_review";
        next.returnToReview = false;
        return { session: next, completed: false };
      case "persona_review":
        switch (text) {
          case "1":
            next.step = "reference_photo_choice";
            next.returnToReview = false;
            return { session: next, completed: false };
          case "2":
            next.step = "name";
            next.returnToReview = true;
            return { session: next, completed: false };
          case "3":
            next.step = "origin_city";
            next.returnToReview = true;
            return { session: next, completed: false };
          case "4":
            next.step = "traits";
            next.returnToReview = true;
            return { session: next, completed: false };
          case "5":
            next.step = "tone";
            next.returnToReview = true;
            return { session: next, completed: false };
          case "6":
            next.step = "relationship";
            next.returnToReview = true;
            return { session: next, completed: false };
          case "7":
            next.step = "user_addressing";
            next.returnToReview = true;
            return { session: next, completed: false };
          case "8":
            return { session: next, completed: false, cancelled: true };
          default:
            throw new Error("请回复 1-8 里的一个选项。");
        }
      case "reference_photo_choice":
        if (text === "1") {
          next.step = "reference_photo";
          next.awaitingReferencePhoto = true;
          return { session: next, completed: false };
        }
        if (
          text === "2" &&
          isPersonaEditSession(input.session) &&
          Boolean(input.session.draft.referenceImageAsset)
        ) {
          next.step = "complete";
          return { session: next, completed: true };
        }
        if (
          text === "2" &&
          !(
            isPersonaEditSession(input.session) &&
            input.session.draft.referenceImageAsset
          )
        ) {
          next.step = "persona_review";
          return { session: next, completed: false };
        }
        if (text === "3" && isPersonaEditSession(input.session)) {
          next.step = "persona_review";
          return { session: next, completed: false };
        }
        throw new Error(
          isPersonaEditSession(input.session) &&
            input.session.draft.referenceImageAsset
            ? "请回复 1、2 或 3。"
            : "请回复 1 或 2。",
        );
      case "complete":
        return { session: next, completed: true };
      default:
        throw new Error("当前 persona setup 步骤不接收文字输入。");
    }
  }

  switch (input.session.step) {
    case "text_provider": {
      const choice = parseTextProviderChoice(text);
      if (!choice) {
        throw new Error(
          "没看懂这个模型选项。回 1/2/3，或者直接回 default / gemini / openai-compatible。",
        );
      }
      next.draft.textProviderKind = choice;
      if (choice === "openai-compatible") {
        next.step = "openai_base_url";
        return { session: next, completed: false };
      }
      if (hasGeminiKeyAlready) {
        next.step = "complete";
        return {
          session: next,
          completed: true,
          configPatch: {
            textProvider: { kind: choice },
          },
        };
      }
      next.step = "gemini_api_key";
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
      return { session: next, completed: false };
    case "openai_api_key":
      next.draft.openaiApiKey = text;
      next.step = "openai_model";
      return { session: next, completed: false };
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
    case "complete":
      return { session: next, completed: true };
    default:
      throw new Error("当前 model setup 步骤不接收文字输入。");
  }
}

export function advanceSetupSessionWithPhoto(input: {
  session: SetupSession;
  referenceImageAsset: string;
}): SetupSession {
  if (
    input.session.kind !== "persona" ||
    input.session.step !== "reference_photo"
  ) {
    throw new Error("当前 setup 步骤不在等待照片。");
  }

  return {
    ...input.session,
    awaitingReferencePhoto: false,
    step: "complete",
    updatedAt: nowIso(),
    draft: {
      ...input.session.draft,
      referenceImageAsset: input.referenceImageAsset,
    },
  };
}

export function renderSetupStepPrompt(session: SetupSession): string {
  if (session.kind === "model") {
    switch (session.step) {
      case "text_provider":
        return [
          "文本模型怎么配？回复一个选项：",
          `当前：${displayValue(session.draft.textProviderKind)}`,
          "1. default（使用当前 OpenClaw 默认模型）",
          "2. gemini",
          "3. openai-compatible",
        ].join("\n");
      case "openai_base_url":
        return [
          "回复 OpenAI-compatible 的 base URL。",
          `当前：${displayValue(session.draft.openaiBaseUrl)}`,
        ].join("\n");
      case "openai_api_key":
        return "回复这个 OpenAI-compatible provider 的 API key。";
      case "openai_model":
        return [
          "回复要使用的模型名。",
          `当前：${displayValue(session.draft.openaiModel)}`,
        ].join("\n");
      case "gemini_api_key":
        return [
          "还差 Gemini API key。",
          "planning 和生图都会共用这一个 key。",
          "Gemini key 获取链接：https://aistudio.google.com/app/apikey",
          "直接把 key 发我就行。",
        ].join("\n");
      case "complete":
        return "模型配置已完成。";
      default:
        return "继续完成模型配置。";
    }
  }

  return buildPersonaStepPrompt(session);
}

export function buildIdleGuideMessage(persona: StoredPersonaProfile): string {
  return [
    "接下来你可以直接告诉我一个想去的目的地，",
    "比如：东京 / 北京 / 巴黎",
    "我就会开始准备这次旅行。",
  ].join("\n");
}

export function buildPersonaCreatedMessage(
  persona: StoredPersonaProfile,
): string {
  return `${persona.name} 创建完成。`;
}

export function buildPersonaUpdatedMessage(persona: StoredPersonaProfile): string {
  return [
    `${persona.name} 的资料已更新。`,
    "",
    "为了避免旧上下文影响体验，建议你先执行：",
    "/travel-companion deactivate",
    "",
    "然后再执行：",
    "/travel-companion activate",
  ].join("\n");
}

export function buildOnboardingGateMessage(input: {
  binding: ConversationBindingRecord;
  readiness: OnboardingReadiness;
  setupSession?: SetupSession | null;
}): string {
  if (input.setupSession?.kind === "persona") {
    return "Ta 的资料还没配完。继续用 /travel-companion setup，然后按提示一步步回复就行。";
  }

  if (input.setupSession?.kind === "model") {
    return "模型配置还没配完。继续用 /travel-companion model，然后按提示一步步回复就行。";
  }

  const missing: string[] = [];
  if (!input.readiness.hasPersona) {
    missing.push("Ta 的角色信息");
  }
  if (!input.readiness.hasTextProvider) {
    missing.push("文本模型配置");
  }
  if (!input.readiness.hasGeminiKey) {
    missing.push("Gemini key（planning 和生图共用）");
  }

  if (!input.readiness.hasPersona && !input.readiness.hasTextProvider && !input.readiness.hasGeminiKey) {
    return [
      "还没完成首次配置。",
      "先运行 /travel-companion setup，完成 Ta 的资料创建。",
      "再运行 /travel-companion model，完成文本模型和 Gemini key 配置。",
    ].join("\n");
  }

  if (!input.readiness.hasPersona) {
    return [
      `还差最后几项配置：${missing.join("、")}`,
      "先运行 /travel-companion setup，我会一步步带你配完 Ta 的资料。",
      "Ta 的资料配好后，再用 /travel-companion model 补模型和 key。",
    ].join("\n");
  }

  return [
    `还差：${missing.join("、")}`,
    "Ta 的资料已经有了。",
    "现在运行 /travel-companion model，把文本模型和 Gemini key 配完就行。",
  ].join("\n");
}

export function createCompletedPersonaProfile(input: {
  draft: SetupSessionDraft;
  existing?: StoredPersonaProfile | null;
}): StoredPersonaProfile {
  const draft = input.draft;
  if (
    !draft.name ||
    !(draft.originCity || draft.homeCity) ||
    !draft.traits?.length ||
    !draft.toneStyle ||
    !draft.relationship ||
    !draft.userAddressing ||
    !draft.referenceImageAsset
  ) {
    throw new Error("setup 还没收集完整的人设信息。");
  }

  return {
    personaId: input.existing?.personaId ?? randomUUID(),
    createdAt: input.existing?.createdAt ?? nowIso(),
    name: draft.name,
    originCity: draft.originCity || draft.homeCity,
    traits: draft.traits,
    toneStyle: draft.toneStyle,
    relationship: draft.relationship,
    userAddressing: draft.userAddressing,
    referenceImageAsset: draft.referenceImageAsset,
  };
}
