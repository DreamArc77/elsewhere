import { readFile } from "node:fs/promises";

import type {
  ImageIntent,
  PhaseGroundingResult,
  ResolvedAgentState,
  RuntimeStepContext,
  StoredPersonaProfile,
  SystemLocale,
  TripPlan,
  TripRequest,
} from "../domain/types.js";

const templateCache = new Map<string, string>();

function promptTemplateUrl(fileName: string): URL {
  return new URL(
    `../../prompts/openclaw-travel-companion/${fileName}`,
    import.meta.url,
  );
}

async function loadTemplate(fileName: string): Promise<string> {
  const cached = templateCache.get(fileName);
  if (cached) {
    return cached;
  }

  const template = await readFile(promptTemplateUrl(fileName), "utf8");
  templateCache.set(fileName, template);
  return template;
}

function renderTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  const rendered = template.replace(
    /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
    (_match, key) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing prompt template value: ${key}`);
      }
      return String(value);
    },
  );

  const unresolved = rendered.match(/{{\s*[a-zA-Z0-9_]+\s*}}/g);
  if (unresolved?.length) {
    throw new Error(
      `Prompt template still has unresolved placeholders: ${unresolved.join(", ")}`,
    );
  }

  return rendered.trim();
}

function summarizeStepContext(stepContext: RuntimeStepContext): string {
  return JSON.stringify(
    {
      kind: stepContext.kind,
      phase: stepContext.phase,
      day: stepContext.day,
      date: stepContext.date,
      theme: stepContext.theme,
      activityIndex: stepContext.activityIndex,
      isExtraMessage: stepContext.isExtraMessage,
      sendMoment: stepContext.sendMoment,
      timing: stepContext.timing,
      currentActivity: stepContext.activity,
      previousActivity: stepContext.previousActivity,
      nextActivity: stepContext.nextActivity,
    },
    null,
    2,
  );
}

export function buildPersonaSummary(persona: StoredPersonaProfile): string {
  return [
    `Name: ${persona.name}`,
    `Residence city: ${persona.originCity || persona.homeCity || "unknown"}`,
    `Personality traits: ${persona.traits.join(", ")}`,
    `Tone style: ${persona.toneStyle}`,
    `Relationship to user: ${persona.relationship}`,
    `How you address the user: ${persona.userAddressing || "未设置"}`,
  ].join("\n");
}

function buildOutputLanguageInstruction(locale: SystemLocale): string {
  switch (locale) {
    case "ja-JP":
      return "Write the visible message in natural Japanese.";
    case "en":
      return "Write the visible message in natural English.";
    case "zh-CN":
    default:
      return "Write the visible message in natural Simplified Chinese.";
  }
}

export async function renderTripPlanPrompt(input: {
  tripId: string;
  persona: StoredPersonaProfile;
  request: TripRequest;
}): Promise<string> {
  const template = await loadTemplate("plan-trip.md");
  return renderTemplate(template, {
    tripId: input.tripId,
    currentDate: new Date().toISOString().slice(0, 10),
    originCity: input.request.originCity,
    destinationCity: input.request.destinationCity,
    tripDaysHint: "3-5",
    startWindow:
      input.request.startWindow ??
      "Choose the nearest realistic departure window based on transport and weather.",
    personaSummary: buildPersonaSummary(input.persona),
  });
}

export async function renderCaptionPrompt(input: {
  persona: StoredPersonaProfile;
  request: TripRequest;
  phase: string;
  day: number;
  stepContext: RuntimeStepContext;
  grounding: PhaseGroundingResult;
  resolvedState: ResolvedAgentState;
  currentSituation: string;
  recentImageSummary: string;
}): Promise<string> {
  const template = await loadTemplate(
    input.resolvedState.stage.substate === "planning" || input.phase === "planning"
      ? "compose-caption-planning.md"
      : "compose-caption.md",
  );
  return renderTemplate(template, {
    personaSummary: buildPersonaSummary(input.persona),
    phase: input.phase,
    day: input.day,
    stepContext: summarizeStepContext(input.stepContext),
    grounding: JSON.stringify(input.grounding, null, 2),
    currentSituation: input.currentSituation,
    recentImageSummary: input.recentImageSummary,
  });
}

export async function renderCompanionReplyPrompt(input: {
  persona: StoredPersonaProfile | null;
  conversationKey: string;
  pendingUserMessages: string;
  recentTurns: string;
  currentSituation: string;
  currentTransportBlock: string;
  recentPhotoBlock: string;
  destinationLoopBlock: string;
  destinationLoopTaskBlock: string;
  locale: SystemLocale;
  now: string;
  latestUserMessageAt: string;
}): Promise<string> {
  const template = await loadTemplate("compose-reply.md");
  return renderTemplate(template, {
    personaSummary: input.persona
      ? buildPersonaSummary(input.persona)
      : "No persona is configured yet.",
    conversationKey: input.conversationKey,
    pendingUserMessages: input.pendingUserMessages,
    recentTurns: input.recentTurns,
    currentSituation: input.currentSituation,
    currentTransportBlock: input.currentTransportBlock,
    recentPhotoBlock: input.recentPhotoBlock,
    destinationLoopBlock: input.destinationLoopBlock,
    destinationLoopTaskBlock: input.destinationLoopTaskBlock,
    outputLanguageInstruction: buildOutputLanguageInstruction(input.locale),
    now: input.now,
    latestUserMessageAt: input.latestUserMessageAt,
  });
}

export async function renderIdleDestinationGuidePrompt(input: {
  persona: StoredPersonaProfile;
  conversationKey: string;
  recentTurns: string;
  currentStateSummary: string;
  locale: SystemLocale;
  now: string;
}): Promise<string> {
  const template = await loadTemplate("compose-idle-guide.md");
  return renderTemplate(template, {
    personaSummary: buildPersonaSummary(input.persona),
    conversationKey: input.conversationKey,
    recentTurns: input.recentTurns,
    currentStateSummary: input.currentStateSummary,
    outputLanguageInstruction: buildOutputLanguageInstruction(input.locale),
    now: input.now,
  });
}

export async function renderDestinationAcknowledgementPrompt(input: {
  persona: StoredPersonaProfile;
  destination: string;
  recentTurns: string;
  locale: SystemLocale;
  now: string;
}): Promise<string> {
  const template = await loadTemplate("compose-destination-ack.md");
  return renderTemplate(template, {
    personaSummary: buildPersonaSummary(input.persona),
    destination: input.destination,
    recentTurns: input.recentTurns,
    outputLanguageInstruction: buildOutputLanguageInstruction(input.locale),
    now: input.now,
  });
}

export async function renderImageGenerationPrompt(input: {
  persona: StoredPersonaProfile;
  request: TripRequest;
  plan: TripPlan;
  stepContext: RuntimeStepContext;
  grounding: PhaseGroundingResult;
  imageIntent: ImageIntent;
}): Promise<string> {
  const template = await loadTemplate(
    input.imageIntent.shotKind === "selfie"
      ? "generate-image-selfie.md"
      : "generate-image-snapshot.md",
  );

  if (input.imageIntent.shotKind === "selfie") {
    return renderTemplate(template, {
      currentTime: input.imageIntent.currentTimeLocal,
      weatherSummary: input.imageIntent.weatherSummary,
      promptLocation: input.imageIntent.promptLocation,
      promptBehavior: input.imageIntent.promptBehavior,
    });
  }

  return renderTemplate(template, {
    currentTime: input.imageIntent.currentTimeLocal,
    weatherSummary: input.imageIntent.weatherSummary,
    promptLocation: input.imageIntent.promptLocation,
    promptBehavior: input.imageIntent.promptBehavior,
  });
}
