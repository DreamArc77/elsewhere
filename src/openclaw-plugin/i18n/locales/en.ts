import type { SystemLocale } from "../../../domain/types.js";
import type { SystemLocaleCatalog } from "../types.js";

export const en: SystemLocaleCatalog = {
  common: {
    none: "none",
    unknown: "unknown",
    invalidOption: "Invalid option.",
    laterRetry: "Please try again later.",
  },
  locale: {
    menu: [
      "Choose system language / システム言語を選んでください / 选择系统语言",
      "1. 简体中文",
      "2. 日本語",
      "3. English",
    ].join("\n"),
    invalid: [
      "Invalid option. Reply with 1 / 2 / 3.",
      "",
      "1. 简体中文",
      "2. 日本語",
      "3. English",
    ].join("\n"),
    completed: "System language has been set.",
    eventLabel(locale: SystemLocale): string {
      return locale === "zh-CN"
        ? "简体中文"
        : locale === "ja-JP"
          ? "日本語"
          : "English";
    },
  },
  help: {
    lines: [
      "/elsewhere bind",
      "/elsewhere activate",
      "/elsewhere deactivate",
      "/elsewhere setup                      # edit the current companion",
      "/elsewhere create                     # create a new companion",
      "/elsewhere model                      # reconfigure the text model / Gemini key",
      "/elsewhere start --to Tokyo [--from Hong-Kong] [--when next-week]",
      "/elsewhere status [--trip <id>]",
      "/elsewhere tick [--trip <id>]         # force delayed replies and the next trip step",
      "/elsewhere tick-reply                 # force delayed replies only",
      "/elsewhere stop [--trip <id>]",
    ],
  },
  command: {
    bindSuccess: "This conversation is now bound to elsewhere.",
    bindNextActivate:
      "Next, run /elsewhere activate to enter companion mode.",
    activateEnabled: "Companion mode is now active.",
    activateReady: "You can now tell your companion a destination directly.",
    deactivateClosed: "Companion mode is now off.",
    deactivateTripStopped: "The current trip has been stopped.",
    deactivateDefaultAssistant:
      "This conversation is back to the default assistant.",
    notReadyBind:
      "This conversation is not ready yet. Run /elsewhere bind in the chat where you want to receive messages.",
    activateFirst:
      "This conversation is not ready yet. Run /elsewhere activate first.",
    notActiveYet:
      "Your companion is not active in this chat yet. Run /elsewhere activate first.",
    approvalRequired(approvalId: string): string {
      return [
        "Conversation takeover approval is required first.",
        `approvalId: ${approvalId}`,
        "Approve it, then run /elsewhere activate again.",
      ].join("\n");
    },
    startCreated({ tripId, destination, days }): string {
      return [
        `Trip created: ${tripId}`,
        `Destination: ${destination}`,
        `Days: ${days}`,
        "The background worker will now advance the trip and proactively send postcards here.",
      ].join("\n");
    },
    startMissingPersona:
      "No default companion is set for this conversation yet. Run /elsewhere setup first, or pass --persona to start.",
    statusNoTrip(input): string {
      return [
        "No recent trip is recorded for this conversation yet.",
        `channel: ${input.channel}`,
        `channelCombinedPostcard: ${input.channelCombinedPostcard}`,
        `channelMediaPostcard: ${input.channelMediaPostcard}`,
        `channelInboundImageSetup: ${input.channelInboundImageSetup}`,
        `channelProactiveMessaging: ${input.channelProactiveMessaging}`,
      ].join("\n");
    },
    tripNotFound(tripId: string): string {
      return `Trip not found: ${tripId}`;
    },
    tickSuccess({ id, status, phase, nextRunAt }): string {
      const lines = [
        `Ticked immediately: ${id}`,
        "reply: processed pending conversation replies",
      ];
      if (status) lines.push(`status: ${status}`);
      if (phase) lines.push(`phase: ${phase}`);
      if (nextRunAt) lines.push(`nextRunAt: ${nextRunAt}`);
      return lines.join("\n");
    },
    tickFailure(id: string): string {
      return [
        `Tick attempted: ${id}`,
        "The postcard or delayed reply could not be confirmed just now.",
        "The state was preserved. Please try /elsewhere tick again shortly.",
      ].join("\n");
    },
    tickReplySuccess(id: string): string {
      return [
        `Ticked reply immediately: ${id}`,
        "reply: processed pending conversation replies",
        "trip: not advanced",
      ].join("\n");
    },
    tickReplyFailure(id: string): string {
      return [
        `Reply tick attempted: ${id}`,
        "The delayed reply could not be confirmed just now.",
        "The state was preserved. Please try /elsewhere tick-reply again shortly.",
      ].join("\n");
    },
    stopNoTrip: "No trip is available to stop.",
    stopSuccess({ tripId, status }): string {
      return [
        `Stopped: ${tripId}`,
        `status: ${status}`,
        "This trip will not schedule more messages.",
        "Conversation runtime state was cleared, your companion stays active, and is now back in idle.",
      ].join("\n");
    },
    tripStartProviderBlocked: [
      "Trip planning failed this time.",
      "Gemini rejected this request because of a provider-side restriction, not because your destination was wrong.",
      "You do not need to resend the destination right now. Please try again later.",
    ].join("\n"),
    tripStartFailed(message?: string): string {
      return [
        "Trip planning failed this time.",
        message ? `Error: ${message}` : "Please try again later.",
      ].join("\n");
    },
    internalFailure:
      "This action could not be completed right now. Please try again later.",
    channelCapabilitySupported: "supported",
    channelCapabilityLimited: "limited",
    channelCapabilityUnsupported: "unsupported",
    channelCapabilityUnknown: "unknown",
  },
  onboarding: {
    gateContinueSetup:
      "Your companion profile is not finished yet. Continue with /elsewhere setup and follow the prompts.",
    gateContinueModel:
      "The model configuration is not finished yet. Continue with /elsewhere model and follow the prompts.",
    gateFirstTime: [
      "Welcome to elsewhere.",
      "You'll have a companion here who can chat with you and go see faraway places for you.",
      "Let's set your companion up first.",
      "",
      "Run /elsewhere setup to finish the companion profile.",
      "Then run /elsewhere model to finish the text model and the planning / image setup.",
    ].join("\n"),
    gateMissingPersona: "companion profile",
    gateMissingModel: "text model configuration",
    gateMissingGemini: "planning / image channel configuration",
    gateMissingSummary(items: string[]): string {
      return `Still missing: ${items.join(", ")}`;
    },
    gatePersonaFirstSetup:
      "Run /elsewhere setup first and I'll guide you through your companion profile step by step.",
    gatePersonaFirstModel:
      "After the companion profile is ready, use /elsewhere model to finish the text model and planning / image setup.",
    gateModelOnlyIntro: "Your companion profile is already set.",
    gateModelOnlyAction:
      "Now run /elsewhere model to finish the text model and planning / image setup.",
    personaCreated: (name) => `${name} has been created.`,
    personaUpdated: (name) => `${name}'s profile has been updated.`,
    personaUpdatedReactivateHint: [
      "To avoid old context affecting the experience, it is recommended to run:",
      "/elsewhere deactivate",
      "",
      "Then run:",
      "/elsewhere activate",
    ].join("\n"),
    modelUpdated: "Model settings have been updated.",
    idleGuideHint: [
      "Next, you can directly tell your companion a destination you want,",
      "for example: Tokyo / Beijing / Paris",
      "and your companion will start preparing the trip.",
    ].join("\n"),
  },
  setup: {
    cancelledCreate: "This setup was cancelled.",
    cancelledEdit: "This edit was cancelled.",
    readyReplyOne: "Reply with 1 when you're ready.",
    keepCurrentHint:
      "Reply with a new value, or reply with 0 to keep the current one.",
    personaIntro: [
      "Let's set up your companion.",
      "",
      "I'll ask for these in order:",
      "1. Name",
      "2. City where your companion lives",
      "3. Personality traits",
      "4. Speaking style",
      "5. Relationship with you",
      "6. How your companion calls you",
      "7. Reference photo",
      "",
      "Reply with 1 when you're ready.",
    ].join("\n"),
    existingPersonaConfirm: [
      "A companion profile already exists.",
      "",
      "This command will edit or overwrite the current profile.",
      "Reply:",
      "1. Continue editing",
      "2. Cancel",
    ].join("\n"),
    currentValue: (value) => `Current value: ${value}`,
    askName: "Let's start with a name for your companion.",
    askOriginCity:
      "Which city does your companion live in right now? This will be used as the default departure city.",
    askTraits: "Use a few words to describe your companion's personality.",
    askTone: "What does your companion's usual speaking style feel like?",
    askRelationship: "What is your companion's relationship with you?",
    askUserAddressing: "How does your companion usually address you?",
    traitsExample: "For example: clingy, sensitive, moody",
    toneExample: "For example: teasing, soft, distant, cheerful",
    relationshipExample:
      "For example: long-distance lover, flirt, travel partner",
    userAddressingExample:
      "For example: babe, dear, your name, a nickname",
    reviewTitle: "Current profile:",
    reviewFieldName: "Name",
    reviewFieldOriginCity: "City where your companion lives",
    reviewFieldTraits: "Personality traits",
    reviewFieldTone: "Speaking style",
    reviewFieldRelationship: "Relationship with you",
    reviewFieldUserAddressing: "How your companion calls you",
    reviewConfirmEdit: "1. Confirm and continue to the reference photo",
    reviewConfirmCreate: "1. Confirm and continue to the reference photo",
    reviewEditName: "2. Edit name",
    reviewEditOriginCity: "3. Edit city where your companion lives",
    reviewEditTraits: "4. Edit personality traits",
    reviewEditTone: "5. Edit speaking style",
    reviewEditRelationship: "6. Edit relationship",
    reviewEditUserAddressing: "7. Edit how your companion calls you",
    reviewCancelEdit: "8. Cancel this edit",
    reviewCancelCreate: "8. Cancel this setup",
    referencePhotoChoiceWithCurrent: [
      "A reference photo already exists.",
      "This photo is used later for selfie generation and mainly shapes your companion's look and vibe.",
      "",
      "Reply:",
      "1. Upload a new reference photo",
      "2. Keep the current reference photo",
      "3. Go back to profile review",
    ].join("\n"),
    referencePhotoChoiceWithoutCurrent: [
      "Last step: reference photo.",
      "This photo is used later for selfie generation and mainly shapes your companion's look and vibe.",
      "A clear solo photo with a visible face, no obstruction, and natural lighting works best.",
      "",
      "Reply:",
      "1. Upload a reference photo",
      "2. Go back to profile review",
    ].join("\n"),
    referencePhotoAwaiting:
      "Okay, just send one image directly. A clear solo photo with a visible face, no obstruction, and natural lighting works best. Try to avoid group shots, heavy filters, or stickers.",
    completePersonaCreated: "Your companion has been created.",
    completePersonaUpdated: "Your companion profile has been updated.",
    completeModel: "Model setup is complete.",
    completeGeneric: "Continue the setup.",
    textProviderChoice: (current) =>
      [
        "How should the text model be configured? Reply with one option:",
        `Current: ${current}`,
        "1. default (use the current OpenClaw default model)",
        "2. gemini",
        "3. openai-compatible",
      ].join("\n"),
    askOpenAiBaseUrl: (current) =>
      [`Reply with the OpenAI-compatible base URL.`, `Current: ${current}`].join(
        "\n",
      ),
    askOpenAiApiKey:
      "Reply with the API key for this OpenAI-compatible provider.",
    askOpenAiModel: (current) =>
      [`Reply with the model name to use.`, `Current: ${current}`].join(
        "\n",
      ),
    geminiProviderChoice: (current) =>
      [
        "Which Gemini channel should planning and image generation use? Reply with one option:",
        `Current: ${current}`,
        "1. google-direct (Gemini API key / AI Studio)",
        "2. openrouter (use an OpenRouter key to call Gemini)",
      ].join("\n"),
    askGeminiApiKey: [
      "A Gemini API key is still needed.",
      "Planning and image generation will share this Google Gemini key.",
      "Get a Gemini key here: https://aistudio.google.com/app/apikey",
      "Just send me the key directly.",
    ].join("\n"),
    askOpenRouterApiKey: [
      "An OpenRouter API key is still needed.",
      "Planning and image generation will share this OpenRouter key and call Gemini through OpenRouter.",
      "Get an OpenRouter key here: https://openrouter.ai/settings/keys",
      "Just send me the key directly.",
    ].join("\n"),
    localeSelectionPersisted: (localeLabel) =>
      `System language has been set to: ${localeLabel}`,
    errorReplyOne: "Reply with 1 when you're ready.",
    errorContinueOrCancel:
      "Reply with 1 to continue editing, or 2 to cancel.",
    errorReviewOption: "Reply with one option from 1-8.",
    errorReferencePhotoChoiceWithCurrent: "Reply with 1, 2, or 3.",
    errorReferencePhotoChoiceWithoutCurrent: "Reply with 1 or 2.",
    errorModelChoice:
      "I couldn't understand that model option. Reply with 1 / 2 / 3, or directly with default / gemini / openai-compatible.",
    errorGeminiProviderChoice:
      "I couldn't understand that planning / image channel option. Reply with 1 / 2, or directly with google-direct / openrouter.",
    errorNeedUserAddressing:
      "Your companion still does not have a way to address you. This field needs to be filled in.",
    errorWaitingForPhoto: "The current setup step is not waiting for a photo.",
    errorWaitingForPhotoWithFallback:
      "I'm currently waiting for your reference photo. You can send an image directly. If image delivery is unstable on this platform, you can also send an image URL, or send `/elsewhere setup --image IMAGE_URL`.",
    errorUnsupportedImage:
      "This image cannot be used as a reference photo right now. Please try another common image format.",
    errorImageDownloadFailed:
      "The reference photo could not be processed. You can resend an image, or send a reachable image URL directly.",
    errorGeneric: "This step did not complete successfully. Please try again.",
  },
  replyErrors: {
    personaRequired:
      "I'm not ready to head out yet. Please use /elsewhere setup to define my persona first, then I'll be able to reply properly.",
    idleDestinationStartFailed:
      "I just tried to turn that into a trip, but it got stuck on my side. Tell me the destination again a bit later and I'll keep trying.",
    planningFailed: "Trip planning failed this time. Please try again later.",
    postcardFailed:
      "This postcard could not be confirmed just now. Please try again later.",
    replyFailed:
      "This reply could not be confirmed just now. Please try again later.",
  },
};
