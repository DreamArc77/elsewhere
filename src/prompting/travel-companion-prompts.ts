import { readFile } from "node:fs/promises";

import type {
  PhaseGroundingResult,
  StoredPersonaProfile,
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
  const rendered = template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Missing prompt template value: ${key}`);
    }
    return String(value);
  });

  const unresolved = rendered.match(/{{\s*[a-zA-Z0-9_]+\s*}}/g);
  if (unresolved?.length) {
    throw new Error(`Prompt template still has unresolved placeholders: ${unresolved.join(", ")}`);
  }

  return rendered.trim();
}

export function buildPersonaSummary(persona: StoredPersonaProfile): string {
  return [
    `Name: ${persona.name}`,
    `Traits: ${persona.traits.join(", ")}`,
    `Relationship to user: ${persona.relationship}`,
    `Tone style: ${persona.toneStyle}`,
  ].join("\n");
}

export async function renderTripPlanPrompt(input: {
  tripId: string;
  persona: StoredPersonaProfile;
  request: TripRequest;
}): Promise<string> {
  const template = await loadTemplate("plan-trip.md");
  return renderTemplate(template, {
    tripId: input.tripId,
    originCity: input.request.originCity,
    destinationCity: input.request.destinationCity,
    startWindow:
      input.request.startWindow ??
      "pick the next reasonable departure window.",
    personaSummary: buildPersonaSummary(input.persona),
  });
}

export async function renderPhaseGroundingPrompt(input: {
  tripId: string;
  persona: StoredPersonaProfile;
  request: TripRequest;
  plan: TripPlan;
  phase: string;
  day: number;
  agenda: unknown;
}): Promise<string> {
  const template = await loadTemplate("phase-grounding.md");
  return renderTemplate(template, {
    tripId: input.tripId,
    originCity: input.request.originCity,
    destinationCity: input.request.destinationCity,
    phase: input.phase,
    day: input.day,
    personaSummary: buildPersonaSummary(input.persona),
    hotelName: input.plan.hotel.name,
    hotelDistrict: input.plan.hotel.district,
    weatherSummary: input.plan.weatherSummary,
    agenda:
      input.agenda === undefined
        ? "n/a"
        : JSON.stringify(input.agenda, null, 2),
  });
}

export async function renderCaptionPrompt(input: {
  persona: StoredPersonaProfile;
  request: TripRequest;
  phase: string;
  day: number;
  grounding: PhaseGroundingResult;
}): Promise<string> {
  const template = await loadTemplate("compose-caption.md");
  return renderTemplate(template, {
    personaSummary: buildPersonaSummary(input.persona),
    destinationCity: input.request.destinationCity,
    phase: input.phase,
    day: input.day,
    grounding: JSON.stringify(input.grounding, null, 2),
  });
}

export async function renderImageGenerationPrompt(input: {
  persona: StoredPersonaProfile;
  request: TripRequest;
  plan: TripPlan;
  grounding: PhaseGroundingResult;
}): Promise<string> {
  const template = await loadTemplate("generate-image.md");
  return renderTemplate(template, {
    name: input.persona.name,
    relationship: input.persona.relationship,
    traits: input.persona.traits.join(", "),
    toneStyle: input.persona.toneStyle,
    originCity: input.request.originCity,
    destinationCity: input.request.destinationCity,
    phase: input.grounding.phase,
    day: input.grounding.day,
    hotelName: input.plan.hotel.name,
    hotelDistrict: input.plan.hotel.district,
    locality: input.grounding.locality,
    weatherSummary: input.grounding.weatherSummary,
    transitSummary: input.grounding.transitSummary,
    venueSummary: input.grounding.venueSummary,
    photoBrief: input.grounding.photoBrief,
    sensoryHighlights: input.grounding.sensoryHighlights.join(", "),
  });
}
