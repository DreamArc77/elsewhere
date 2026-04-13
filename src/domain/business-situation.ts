import { getCurrentStep } from "./state-machine.js";
import {
  CompanionBusinessSituation,
  ItineraryActivity,
  RuntimeStepContext,
  TripRecord,
} from "./types.js";

const IDLE_REPLY_DELAY_MS = 2 * 60 * 1000;
const TRAVEL_REPLY_DELAY_MS = 3 * 60 * 1000;
const MOVING_REPLY_DELAY_MS = 8 * 60 * 1000;

function looksLikeAirportContext(activity: ItineraryActivity): boolean {
  const haystack = [
    activity.location,
    activity.address,
    activity.description,
    activity.transport_memo,
  ]
    .join(" ")
    .toLowerCase();

  return /airport|terminal|gate|runway|lounge|airline|boarding|候机|航站|机场/u.test(
    haystack,
  );
}

function deriveSceneFromContext(
  context: RuntimeStepContext,
): CompanionBusinessSituation["scene"] {
  if (context.kind === "planning") {
    return "planning";
  }
  if (context.kind === "home_reflection") {
    return "reflection";
  }

  switch (context.activity.type) {
    case "transport":
      return looksLikeAirportContext(context.activity) ? "airport" : "transport";
    case "accommodation":
      return "hotel";
    case "food":
      return "food";
    case "shopping":
      return "shopping";
    case "sightseeing":
      return "sightseeing";
    default:
      return "idle";
  }
}

function derivePresence(input: {
  scene: CompanionBusinessSituation["scene"];
  context: RuntimeStepContext;
}): CompanionBusinessSituation["presence"] {
  if (
    input.context.phase === "departing" ||
    input.context.phase === "in_transit" ||
    input.context.phase === "returning"
  ) {
    return "moving";
  }

  switch (input.scene) {
    case "airport":
    case "transport":
      return "moving";
    case "hotel":
      return "resting";
    case "planning":
      return "busy";
    default:
      return "available";
  }
}

function deriveReplyDelayMs(
  input: Pick<CompanionBusinessSituation, "mode" | "presence">,
): number {
  if (input.mode !== "traveling") {
    return IDLE_REPLY_DELAY_MS;
  }
  return input.presence === "moving"
    ? MOVING_REPLY_DELAY_MS
    : TRAVEL_REPLY_DELAY_MS;
}

export function deriveCompanionBusinessSituation(
  activeTrip: TripRecord | null,
): CompanionBusinessSituation {
  if (!activeTrip) {
    return {
      mode: "idle",
      scene: "idle",
      presence: "available",
      currentPhase: "system",
      currentDay: 0,
      contextKind: "none",
      sendMoment: "none",
      isExtraMessage: false,
      postcardEligible: false,
      replyDelayMs: IDLE_REPLY_DELAY_MS,
    };
  }

  const currentStep = getCurrentStep(activeTrip);
  if (!currentStep?.context) {
    return {
      mode: "trip-finished",
      scene: "reflection",
      presence: "available",
      currentPhase: activeTrip.state.currentPhase,
      currentDay: activeTrip.state.currentDay,
      contextKind: "none",
      sendMoment: "none",
      isExtraMessage: false,
      postcardEligible: false,
      replyDelayMs: IDLE_REPLY_DELAY_MS,
    };
  }

  const scene = deriveSceneFromContext(currentStep.context);
  const presence = derivePresence({
    scene,
    context: currentStep.context,
  });

  return {
    mode: "traveling",
    scene,
    presence,
    currentPhase: currentStep.phase,
    currentDay: currentStep.day,
    contextKind: currentStep.context.kind,
    sendMoment: currentStep.context.sendMoment,
    isExtraMessage: currentStep.context.isExtraMessage,
    postcardEligible: currentStep.emitsPostcard,
    replyDelayMs: deriveReplyDelayMs({
      mode: "traveling",
      presence,
    }),
  };
}

