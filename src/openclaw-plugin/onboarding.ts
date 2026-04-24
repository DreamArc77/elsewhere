import { randomUUID } from "node:crypto";

import type {
  ConversationBindingRecord,
  SetupSession,
  SetupSessionDraft,
  SetupSessionKind,
  StoredPersonaProfile,
  SystemLocale,
  TravelCompanionPlanningImageProviderChannel,
  TravelCompanionPlanningImageProviderFamily,
  TravelCompanionPlanningImageProviderKind,
  TravelCompanionGlobalConfig,
  TravelCompanionTextProviderKind,
} from "../domain/types.js";
import { getSystemCatalog } from "./i18n/catalog.js";
import { hasConfiguredGeminiProvider } from "./gemini-provider-config.js";

function nowIso(): string {
  return new Date().toISOString();
}

function displayValue(
  value: string | undefined,
  locale: SystemLocale,
): string {
  const text = value?.trim();
  return text ? text : getSystemCatalog(locale).common.none;
}

function displayList(
  values: string[] | undefined,
  locale: SystemLocale,
): string {
  return values?.length ? values.join(" / ") : getSystemCatalog(locale).common.none;
}

function isPersonaEditSession(session: SetupSession): boolean {
  return session.kind === "persona" && Boolean(session.personaTargetId);
}

function shouldKeepCurrent(text: string, session: SetupSession): boolean {
  return isPersonaEditSession(session) && text.trim() === "0";
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

function buildPersonaSummary(
  session: SetupSession,
  locale: SystemLocale,
): string[] {
  const catalog = getSystemCatalog(locale);
  const clean = (text: string) => text.replace(/[？?。.:：]+$/u, "");
  return [
    `1. ${clean(catalog.setup.askName)}: ${displayValue(session.draft.name, locale)}`,
    `2. ${clean(catalog.setup.askOriginCity)}: ${displayValue(session.draft.originCity || session.draft.homeCity, locale)}`,
    `3. ${clean(catalog.setup.askTraits)}: ${displayList(session.draft.traits, locale)}`,
    `4. ${clean(catalog.setup.askTone)}: ${displayValue(session.draft.toneStyle, locale)}`,
    `5. ${clean(catalog.setup.askRelationship)}: ${displayValue(session.draft.relationship, locale)}`,
    `6. ${clean(catalog.setup.askUserAddressing)}: ${displayValue(session.draft.userAddressing, locale)}`,
  ];
}

function buildPersonaReviewLines(
  session: SetupSession,
  locale: SystemLocale,
): string[] {
  const catalog = getSystemCatalog(locale);
  return [
    `${catalog.setup.reviewFieldName}：${displayValue(session.draft.name, locale)}`,
    `${catalog.setup.reviewFieldOriginCity}：${displayValue(session.draft.originCity || session.draft.homeCity, locale)}`,
    `${catalog.setup.reviewFieldTraits}：${displayList(session.draft.traits, locale)}`,
    `${catalog.setup.reviewFieldTone}：${displayValue(session.draft.toneStyle, locale)}`,
    `${catalog.setup.reviewFieldRelationship}：${displayValue(session.draft.relationship, locale)}`,
    `${catalog.setup.reviewFieldUserAddressing}：${displayValue(session.draft.userAddressing, locale)}`,
  ];
}

function buildCurrentValuePrompt(input: {
  locale: SystemLocale;
  currentValue: string;
  body: string[];
}): string {
  const catalog = getSystemCatalog(input.locale);
  return [
    catalog.setup.currentValue(input.currentValue),
    ...input.body,
    catalog.setup.keepCurrentHint,
  ].join("\n");
}

function buildPersonaStepPrompt(
  session: SetupSession,
  locale: SystemLocale,
): string {
  const catalog = getSystemCatalog(locale);
  const editing = isPersonaEditSession(session);

  switch (session.step) {
    case "locale_select":
      return catalog.locale.menu;
    case "persona_intro":
      return catalog.setup.personaIntro;
    case "existing_persona_confirm":
      return catalog.setup.existingPersonaConfirm;
    case "name":
      return editing
        ? buildCurrentValuePrompt({
            locale,
            currentValue: displayValue(session.draft.name, locale),
            body: [catalog.setup.askName],
          })
        : catalog.setup.askName;
    case "origin_city":
      return editing
        ? buildCurrentValuePrompt({
            locale,
            currentValue: displayValue(
              session.draft.originCity || session.draft.homeCity,
              locale,
            ),
            body: [catalog.setup.askOriginCity],
          })
        : catalog.setup.askOriginCity;
    case "traits":
      return editing
        ? buildCurrentValuePrompt({
            locale,
            currentValue: displayList(session.draft.traits, locale),
            body: [catalog.setup.askTraits],
          })
        : catalog.setup.askTraits;
    case "tone":
      return editing
        ? buildCurrentValuePrompt({
            locale,
            currentValue: displayValue(session.draft.toneStyle, locale),
            body: [catalog.setup.askTone],
          })
        : catalog.setup.askTone;
    case "relationship":
      return editing
        ? buildCurrentValuePrompt({
            locale,
            currentValue: displayValue(session.draft.relationship, locale),
            body: [catalog.setup.askRelationship],
          })
        : catalog.setup.askRelationship;
    case "user_addressing":
      return editing
        ? buildCurrentValuePrompt({
            locale,
            currentValue: displayValue(session.draft.userAddressing, locale),
            body: [catalog.setup.askUserAddressing],
          })
        : catalog.setup.askUserAddressing;
    case "persona_review":
      return [
        catalog.setup.reviewTitle,
        "",
        ...buildPersonaReviewLines(session, locale),
        "",
        editing ? catalog.setup.reviewConfirmEdit : catalog.setup.reviewConfirmCreate,
        catalog.setup.reviewEditName,
        catalog.setup.reviewEditOriginCity,
        catalog.setup.reviewEditTraits,
        catalog.setup.reviewEditTone,
        catalog.setup.reviewEditRelationship,
        catalog.setup.reviewEditUserAddressing,
        editing ? catalog.setup.reviewCancelEdit : catalog.setup.reviewCancelCreate,
      ].join("\n");
    case "reference_photo_choice":
      return editing && session.draft.referenceImageAsset
        ? catalog.setup.referencePhotoChoiceWithCurrent
        : catalog.setup.referencePhotoChoiceWithoutCurrent;
    case "reference_photo":
      return catalog.setup.referencePhotoAwaiting;
    case "complete":
      return editing
        ? catalog.setup.completePersonaUpdated
        : catalog.setup.completePersonaCreated;
    default:
      return catalog.setup.completeGeneric;
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
  fallbackOpenAiApiKey?: string;
  fallbackOpenRouterApiKey?: string;
}): OnboardingReadiness {
  const hasPersona = Boolean(input.binding.defaultPersonaId);
  const hasTextProvider = Boolean(input.config.textProvider?.kind);
  const hasGeminiKey = hasConfiguredGeminiProvider({
    globalConfig: input.config,
    pluginConfig: {
      geminiApiKey: input.fallbackGeminiApiKey,
      openaiApiKey: input.fallbackOpenAiApiKey,
      openrouterApiKey: input.fallbackOpenRouterApiKey,
    },
  });

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
  const planningImageProvider =
    config.planningImageProvider ??
    (config.geminiProvider?.kind === "openrouter"
      ? {
          kind: "gemini-openrouter" as const,
          family: "gemini" as const,
          channel: "openrouter" as const,
          apiKey: config.geminiProvider.apiKey,
        }
      : config.geminiProvider?.kind === "openai-direct"
        ? {
            kind: "openai-direct" as const,
            family: "openai" as const,
            channel: "native" as const,
            apiKey: config.geminiProvider.apiKey,
          }
        : config.geminiProvider?.kind === "google-direct" ||
            config.geminiApiKey?.trim()
          ? {
              kind: "gemini-direct" as const,
              family: "gemini" as const,
              channel: "native" as const,
              apiKey: config.geminiProvider?.apiKey ?? config.geminiApiKey,
            }
          : undefined);

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
    planningImageFamily: planningImageProvider?.family,
    planningImageChannel: planningImageProvider?.channel,
    planningImageProviderKind: planningImageProvider?.kind,
    planningImageApiKey: planningImageProvider?.apiKey,
  };
}

export function createSetupSession(input?: {
  kind?: SetupSessionKind;
  draft?: SetupSessionDraft;
  step?: SetupSession["step"];
  personaTargetId?: string;
  forceGeminiReconfigure?: boolean;
}): SetupSession {
  const timestamp = nowIso();
  const kind = input?.kind ?? "persona";

  const defaultStep =
    kind === "locale"
      ? "locale_select"
      : kind === "model"
        ? "text_provider"
        : "persona_intro";

  return {
    kind,
    personaTargetId: input?.personaTargetId,
    forceGeminiReconfigure: input?.forceGeminiReconfigure,
    step: input?.step ?? defaultStep,
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
  if (["1", "default", "host-default", "host", "openclaw"].includes(normalized)) {
    return "host-default";
  }
  if (["2", "gemini", "google"].includes(normalized)) {
    return "gemini";
  }
  if (["3", "openai", "openai-compatible", "compatible"].includes(normalized)) {
    return "openai-compatible";
  }
  return null;
}

export function parsePlanningImageFamilyChoice(
  value: string,
): TravelCompanionPlanningImageProviderFamily | null {
  const normalized = value.trim().toLowerCase();
  if (["1", "gemini", "google"].includes(normalized)) {
    return "gemini";
  }
  if (["2", "openai", "oa"].includes(normalized)) {
    return "openai";
  }
  return null;
}

export function parsePlanningImageChannelChoice(
  value: string,
): TravelCompanionPlanningImageProviderChannel | null {
  const normalized = value.trim().toLowerCase();
  if (["1", "native", "direct"].includes(normalized)) {
    return "native";
  }
  if (["2", "openrouter", "or"].includes(normalized)) {
    return "openrouter";
  }
  return null;
}

function composePlanningImageProviderKind(input: {
  family: TravelCompanionPlanningImageProviderFamily;
  channel: TravelCompanionPlanningImageProviderChannel;
}): TravelCompanionPlanningImageProviderKind {
  return `${input.family}-${input.channel}` as TravelCompanionPlanningImageProviderKind;
}

export function advanceSetupSessionWithText(input: {
  session: SetupSession;
  text: string;
  locale?: SystemLocale;
  globalConfig: TravelCompanionGlobalConfig;
  fallbackGeminiApiKey?: string;
  fallbackOpenAiApiKey?: string;
  fallbackOpenRouterApiKey?: string;
}): {
  session: SetupSession;
  completed: boolean;
  cancelled?: boolean;
  selectedLocale?: SystemLocale;
  configPatch?: Partial<TravelCompanionGlobalConfig>;
} {
  const text = input.text.trim();
  const locale = input.locale ?? "zh-CN";
  const catalog = getSystemCatalog(locale);
  const updatedAt = nowIso();
  const hasPlanningImageProviderAlready = hasConfiguredGeminiProvider({
    globalConfig: input.globalConfig,
    pluginConfig: {
      geminiApiKey: input.fallbackGeminiApiKey,
      openaiApiKey: input.fallbackOpenAiApiKey,
      openrouterApiKey: input.fallbackOpenRouterApiKey,
    },
  });
  const shouldForceGeminiReconfigure =
    input.session.kind === "model" && Boolean(input.session.forceGeminiReconfigure);

  const next: SetupSession = {
    ...input.session,
    draft: { ...input.session.draft },
    updatedAt,
  };

  if (input.session.kind === "locale") {
    if (text === "1" || text === "2" || text === "3") {
      const selectedLocale =
        text === "1" ? "zh-CN" : text === "2" ? "ja-JP" : "en";
      next.step = "complete";
      return {
        session: next,
        completed: true,
        selectedLocale,
      };
    }

    throw new Error(catalog.locale.invalid);
  }

  if (input.session.kind === "persona") {
    switch (input.session.step) {
      case "persona_intro":
        if (text !== "1") {
          throw new Error(catalog.setup.errorReplyOne);
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
        throw new Error(catalog.setup.errorContinueOrCancel);
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
          throw new Error(catalog.setup.errorNeedUserAddressing);
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
            throw new Error(catalog.setup.errorReviewOption);
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
          !(isPersonaEditSession(input.session) && input.session.draft.referenceImageAsset)
        ) {
          next.step = "persona_review";
          return { session: next, completed: false };
        }
        if (text === "3" && isPersonaEditSession(input.session)) {
          next.step = "persona_review";
          return { session: next, completed: false };
        }
        throw new Error(
          isPersonaEditSession(input.session) && input.session.draft.referenceImageAsset
            ? catalog.setup.errorReferencePhotoChoiceWithCurrent
            : catalog.setup.errorReferencePhotoChoiceWithoutCurrent,
        );
      case "complete":
        return { session: next, completed: true };
      default:
        throw new Error(catalog.setup.errorGeneric);
    }
  }

  switch (input.session.step) {
    case "text_provider": {
      const choice = parseTextProviderChoice(text);
      if (!choice) {
        throw new Error(catalog.setup.errorModelChoice);
      }
      next.draft.textProviderKind = choice;
      if (choice === "openai-compatible") {
        next.step = "openai_base_url";
        return { session: next, completed: false };
      }
      if (hasPlanningImageProviderAlready && !shouldForceGeminiReconfigure) {
        next.step = "complete";
        return {
          session: next,
          completed: true,
          configPatch: { textProvider: { kind: choice } },
        };
      }
      next.step = "planning_image_family";
      return {
        session: next,
        completed: false,
        configPatch: { textProvider: { kind: choice } },
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
      if (hasPlanningImageProviderAlready && !shouldForceGeminiReconfigure) {
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
      next.step = "planning_image_family";
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
    case "planning_image_family": {
      const choice = parsePlanningImageFamilyChoice(text);
      if (!choice) {
        throw new Error(catalog.setup.errorGeminiProviderChoice);
      }
      next.draft.planningImageFamily = choice;
      next.step = "planning_image_channel";
      return { session: next, completed: false };
    }
    case "planning_image_channel": {
      const channel = parsePlanningImageChannelChoice(text);
      if (!channel) {
        throw new Error(catalog.setup.errorGeminiProviderChoice);
      }
      next.draft.planningImageChannel = channel;
      next.draft.planningImageProviderKind =
        next.draft.planningImageFamily
          ? composePlanningImageProviderKind({
              family: next.draft.planningImageFamily,
              channel,
            })
          : undefined;
      next.step = "planning_image_api_key";
      return { session: next, completed: false };
    }
    case "planning_image_api_key":
      next.step = "complete";
      next.draft.planningImageProviderKind =
        next.draft.planningImageProviderKind ??
        composePlanningImageProviderKind({
          family: next.draft.planningImageFamily ?? "gemini",
          channel: next.draft.planningImageChannel ?? "native",
        });
      next.draft.planningImageApiKey = text;
      return {
        session: next,
        completed: true,
        configPatch: {
          geminiApiKey:
            next.draft.planningImageProviderKind === "gemini-direct"
              ? text
              : undefined,
          geminiProvider:
            next.draft.planningImageProviderKind === "gemini-direct"
              ? {
                  kind: "google-direct",
                  apiKey: text,
                }
              : undefined,
          planningImageProvider: {
            kind:
              next.draft.planningImageProviderKind ??
              composePlanningImageProviderKind({
                family: next.draft.planningImageFamily ?? "gemini",
                channel: next.draft.planningImageChannel ?? "native",
              }),
            family: next.draft.planningImageFamily ?? "gemini",
            channel: next.draft.planningImageChannel ?? "native",
            apiKey: text,
          },
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
      throw new Error(catalog.setup.errorGeneric);
  }
}

export function advanceSetupSessionWithPhoto(input: {
  session: SetupSession;
  referenceImageAsset: string;
  locale?: SystemLocale;
}): SetupSession {
  if (
    input.session.kind !== "persona" ||
    input.session.step !== "reference_photo"
  ) {
    throw new Error(
      getSystemCatalog(input.locale ?? "zh-CN").setup.errorWaitingForPhoto,
    );
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

export function renderSetupStepPrompt(
  session: SetupSession,
  locale: SystemLocale = "zh-CN",
): string {
  const catalog = getSystemCatalog(locale);

  if (session.kind === "locale") {
    return catalog.locale.menu;
  }

  if (session.kind === "model") {
    switch (session.step) {
      case "text_provider":
        return catalog.setup.textProviderChoice(
          displayValue(session.draft.textProviderKind, locale),
        );
      case "openai_base_url":
        return catalog.setup.askOpenAiBaseUrl(
          displayValue(session.draft.openaiBaseUrl, locale),
        );
      case "openai_api_key":
        return catalog.setup.askOpenAiApiKey;
      case "openai_model":
        return catalog.setup.askOpenAiModel(
          displayValue(session.draft.openaiModel, locale),
        );
      case "planning_image_family":
        return catalog.setup.geminiProviderChoice(
          displayValue(session.draft.planningImageFamily, locale),
        );
      case "planning_image_channel":
        return catalog.setup.planImageChannelChoice(
          displayValue(session.draft.planningImageChannel, locale),
          displayValue(session.draft.planningImageFamily, locale),
        );
      case "planning_image_api_key":
        if (session.draft.planningImageChannel === "openrouter") {
          return catalog.setup.askOpenRouterApiKey(
            displayValue(session.draft.planningImageFamily, locale),
          );
        }
        return session.draft.planningImageFamily === "openai"
          ? catalog.setup.askPlanImageOpenAiApiKey
          : catalog.setup.askGeminiApiKey;
      case "complete":
        return catalog.setup.completeModel;
      default:
        return catalog.setup.completeGeneric;
    }
  }

  return buildPersonaStepPrompt(session, locale);
}

export function buildPersonaCreatedMessage(
  persona: StoredPersonaProfile,
  locale: SystemLocale = "zh-CN",
): string {
  return getSystemCatalog(locale).onboarding.personaCreated(persona.name);
}

export function buildPersonaUpdatedMessage(
  persona: StoredPersonaProfile,
  locale: SystemLocale = "zh-CN",
): string {
  const catalog = getSystemCatalog(locale);
  return [
    catalog.onboarding.personaUpdated(persona.name),
    "",
    catalog.onboarding.personaUpdatedReactivateHint,
  ].join("\n");
}

export function buildOnboardingGateMessage(input: {
  binding: ConversationBindingRecord;
  readiness: OnboardingReadiness;
  setupSession?: SetupSession | null;
  locale?: SystemLocale;
}): string {
  const locale = input.locale ?? "zh-CN";
  const catalog = getSystemCatalog(locale);

  if (input.setupSession?.kind === "persona") {
    return catalog.onboarding.gateContinueSetup;
  }

  if (input.setupSession?.kind === "model") {
    return catalog.onboarding.gateContinueModel;
  }

  if (
    !input.readiness.hasPersona &&
    !input.readiness.hasTextProvider &&
    !input.readiness.hasGeminiKey
  ) {
    return catalog.onboarding.gateFirstTime;
  }

  return catalog.onboarding.gateFirstTime;
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
    throw new Error("setup is missing required persona fields");
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
