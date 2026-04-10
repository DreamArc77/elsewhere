import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";

import { CompanionConversationService } from "../application/companion-conversation-service.js";
import { OpenClawTravelCompanionService } from "../application/openclaw-travel-companion-service.js";
import { TripRecord, TripRepository } from "../domain/types.js";
import { BindingRegistryStore, bindingKey } from "./binding-state.js";
import { TravelCompanionPluginConfig } from "./config.js";
import {
  extractReferenceImageInput,
  materializeReferenceImage,
} from "./reference-image.js";
import { RuntimeDataPaths } from "../infrastructure/json-file-repositories.js";

type CommandReply = { text: string; isError?: boolean };

interface CommandDependencies {
  service: OpenClawTravelCompanionService;
  conversationService: CompanionConversationService;
  tripRepository: TripRepository;
  bindings: BindingRegistryStore;
  pluginConfig: TravelCompanionPluginConfig;
  runtimeDataPaths: RuntimeDataPaths;
}

type ParsedArgs = {
  subcommand: string;
  options: Record<string, string>;
};

export async function handleTravelCompanionCommand(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const parsed = parseArgs(ctx.args);

  switch (parsed.subcommand) {
    case "bind":
      return bindConversation(ctx, deps.bindings);
    case "activate":
      return activateConversation(ctx, deps);
    case "deactivate":
      return deactivateConversation(ctx, deps);
    case "setup":
      return requireActivatedThen(ctx, deps, () => setupPersona(ctx, parsed.options, deps));
    case "start":
      return requireActivatedThen(ctx, deps, () => startTrip(ctx, parsed.options, deps));
    case "status":
      return requireActivatedThen(ctx, deps, () => statusTrip(ctx, parsed.options, deps));
    case "tick":
      return requireActivatedThen(ctx, deps, () => tickTrip(ctx, parsed.options, deps));
    case "stop":
      return requireActivatedThen(ctx, deps, () => stopTrip(ctx, parsed.options, deps));
    default:
      return { text: helpText() };
  }
}

async function bindConversation(
  ctx: PluginCommandContext,
  bindings: BindingRegistryStore,
): Promise<CommandReply> {
  const binding = await ensurePluginConversationBinding(ctx, bindings, "default");
  if ("reply" in binding) {
    return {
      text: binding.reply.text,
      isError: binding.reply.isError,
    };
  }

  return {
    text: ["Binding complete.", "Run /travel-companion activate to enter companion-exclusive mode."].join("\n"),
  };
}

async function activateConversation(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await ensurePluginConversationBinding(
    ctx,
    deps.bindings,
    "companion-exclusive",
  );
  if ("reply" in binding) {
    return binding.reply;
  }

  const activatedBinding = {
    ...binding.record,
    mode: "companion-exclusive" as const,
  };
  await deps.bindings.upsert(activatedBinding);
  await deps.conversationService.activateConversation(activatedBinding);

  return {
    text: [
      "Travel companion takeover is now active.",
      "This chat is in companion-exclusive mode.",
      "You can now run setup/start/status/tick/stop here.",
    ].join("\n"),
  };
}

async function deactivateConversation(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings);
  if ("reply" in binding) {
    return binding.reply;
  }

  if (binding.record.lastTripId) {
    await deps.service.stopTrip(binding.record.lastTripId);
  }

  const nextBinding = {
    ...binding.record,
    mode: "default" as const,
    lastTripId: undefined,
  };
  await deps.bindings.upsert(nextBinding);
  await deps.conversationService.deactivateConversation(binding.record.key);
  await ctx.detachConversationBinding();

  return {
    text: [
      "Travel companion takeover is now deactivated.",
      "The active trip has been stopped.",
      "This chat is back to the default OpenClaw assistant.",
    ].join("\n"),
  };
}

async function setupPersona(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings);
  if ("reply" in binding) {
    return binding.reply;
  }

  const referenceImageInput = extractReferenceImageInput(
    options.image,
    ctx.commandBody,
  );
  if (!referenceImageInput) {
    throw new Error(
      "Missing reference image. Pass --image <absolute-path-or-image-url>, or paste an image URL in the setup command.",
    );
  }
  const referenceImageAsset = await materializeReferenceImage({
    source: referenceImageInput,
    personasDir: deps.runtimeDataPaths.personasDir,
  });

  const persona = await deps.service.createPersona({
    name: requiredOption(options, "name"),
    traits: requiredOption(options, "traits")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    relationship: requiredOption(options, "relationship"),
    toneStyle: requiredOption(options, "tone"),
    referenceImageAsset,
  });

  await deps.bindings.upsert({
    ...binding.record,
    defaultPersonaId: persona.personaId,
  });

  return {
    text: [
      `Persona created: ${persona.name}`,
      `personaId: ${persona.personaId}`,
      "This conversation now uses that persona by default.",
    ].join("\n"),
  };
}

async function startTrip(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings);
  if ("reply" in binding) {
    return binding.reply;
  }

  const personaId = options.persona ?? binding.record.defaultPersonaId;
  if (!personaId) {
    return {
      text: "No default persona is set for this conversation. Run /travel-companion setup first, or pass --persona.",
      isError: true,
    };
  }

  const trip = await deps.service.startTrip({
    personaId,
    originCity: options.from ?? deps.pluginConfig.defaultOriginCity ?? "Hong Kong",
    destinationCity: requiredOption(options, "to"),
    startWindow: options.when,
  });

  const patchedTrip: TripRecord = {
    ...trip,
    deliveryBinding: {
      bindingId: binding.record.bindingId,
      channel: binding.record.channel,
      accountId: binding.record.accountId,
      target: binding.record.target,
      parentConversationId: binding.record.parentConversationId,
      threadId: binding.record.threadId,
      boundAt: binding.record.boundAt,
    },
  };
  await deps.tripRepository.save(patchedTrip);
  await deps.bindings.upsert({
    ...binding.record,
    lastTripId: patchedTrip.tripId,
    defaultPersonaId: personaId,
  });

  return {
    text: [
      `Trip created: ${patchedTrip.tripId}`,
      `Destination: ${patchedTrip.request.destinationCity}`,
      `Days: ${patchedTrip.plan.metadata.days}`,
      "The background worker will now advance the trip and proactively send postcards here.",
    ].join("\n"),
  };
}

async function statusTrip(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings);
  if ("reply" in binding) {
    return binding.reply;
  }

  const tripId = options.trip ?? binding.record.lastTripId;
  if (!tripId) {
    return {
      text: "No recent trip is recorded for this conversation yet.",
      isError: true,
    };
  }

  const trip = await deps.tripRepository.getById(tripId);
  if (!trip) {
    return { text: `Trip not found: ${tripId}`, isError: true };
  }

  return {
    text: [
      `tripId: ${trip.tripId}`,
      `status: ${trip.state.status}`,
      `phase: ${trip.state.currentPhase}`,
      `day: ${trip.state.currentDay}`,
      `nextRunAt: ${trip.state.nextRunAt ?? "none"}`,
      `artifacts: ${trip.state.artifacts.length}`,
    ].join("\n"),
  };
}

async function tickTrip(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings);
  if ("reply" in binding) {
    return binding.reply;
  }

  const tripId = options.trip ?? binding.record.lastTripId;

  try {
    await deps.conversationService.runConversation(binding.record.key, {
      ignoreSchedule: true,
    });

    if (!tripId) {
      return {
        text: [
          `Ticked immediately: ${binding.record.key}`,
          "reply: processed pending conversation replies",
          "trip: none",
        ].join("\n"),
      };
    }

    const trip = await deps.service.runTrip(tripId, { ignoreSchedule: true });
    return {
      text: [
        `Ticked immediately: ${trip.tripId}`,
        "reply: processed pending conversation replies",
        `status: ${trip.state.status}`,
        `phase: ${trip.state.currentPhase}`,
        `nextRunAt: ${trip.state.nextRunAt ?? "none"}`,
      ].join("\n"),
    };
  } catch {
    return {
      text: [
        `Tick attempted: ${tripId ?? binding.record.key}`,
        "The postcard or delayed reply could not be confirmed just now.",
        "The state was preserved. Please try /travel-companion tick again shortly.",
      ].join("\n"),
      isError: true,
    };
  }
}

async function stopTrip(
  ctx: PluginCommandContext,
  options: Record<string, string>,
  deps: CommandDependencies,
): Promise<CommandReply> {
  const binding = await requireBinding(ctx, deps.bindings);
  if ("reply" in binding) {
    return binding.reply;
  }

  const tripId = options.trip ?? binding.record.lastTripId;
  if (!tripId) {
    return { text: "No trip is available to stop.", isError: true };
  }

  const trip = await deps.service.stopTrip(tripId);
  return {
    text: [
      `Stopped: ${trip.tripId}`,
      `status: ${trip.state.status}`,
      "This trip will not schedule more messages.",
    ].join("\n"),
  };
}

async function requireBinding(
  ctx: PluginCommandContext,
  bindings: BindingRegistryStore,
): Promise<
  | { record: NonNullable<Awaited<ReturnType<BindingRegistryStore["get"]>>> }
  | { reply: CommandReply }
> {
  const currentBinding = await ctx.getCurrentConversationBinding();
  if (currentBinding) {
    const existing = await bindings.get(
      bindingKey({
        channel: currentBinding.channel,
        accountId: currentBinding.accountId,
        target: currentBinding.conversationId,
        threadId: currentBinding.threadId,
      }),
    );
    const record = {
      ...(existing ?? {}),
      key: bindingKey({
        channel: currentBinding.channel,
        accountId: currentBinding.accountId,
        target: currentBinding.conversationId,
        threadId: currentBinding.threadId,
      }),
      bindingId: currentBinding.bindingId,
      channel: currentBinding.channel,
      accountId: currentBinding.accountId,
      target: currentBinding.conversationId,
      parentConversationId: currentBinding.parentConversationId,
      threadId: currentBinding.threadId,
      boundAt: currentBinding.boundAt,
      mode: existing?.mode ?? "default",
      defaultPersonaId: existing?.defaultPersonaId,
      lastTripId: existing?.lastTripId,
    };
    await bindings.upsert(record);
    return { record };
  }

  const inferred = inferBindingRecord(ctx);
  if (!inferred) {
    return {
      reply: {
        text: "This conversation is not ready yet. Run /travel-companion bind in the Telegram chat where you want to receive postcards.",
        isError: true,
      },
    };
  }

  const record = await bindings.get(inferred.key);
  if (record) {
    return { record };
  }

  await bindings.upsert(inferred);
  return { record: inferred };
}

async function requireActivatedThen(
  ctx: PluginCommandContext,
  deps: CommandDependencies,
  fn: () => Promise<CommandReply>,
): Promise<CommandReply> {
  const resolved = await requireBinding(ctx, deps.bindings);
  if ("reply" in resolved) {
    return {
      text: "This conversation is not ready yet. Run /travel-companion activate first.",
      isError: true,
    };
  }

  if (resolved.record.mode !== "companion-exclusive") {
    return {
      text: "Travel companion is not active in this chat yet. Run /travel-companion activate first.",
      isError: true,
    };
  }

  return fn();
}

function inferBindingRecord(
  ctx: PluginCommandContext,
): Awaited<ReturnType<BindingRegistryStore["get"]>> | null {
  const target = inferConversationTarget(ctx);
  if (!target) {
    return null;
  }

  const key = bindingKey({
    channel: ctx.channel,
    accountId: ctx.accountId,
    target,
    threadId: ctx.messageThreadId,
  });
  return {
    key,
    bindingId: undefined,
    channel: ctx.channel,
    accountId: ctx.accountId,
    target,
    parentConversationId: ctx.threadParentId,
    threadId: ctx.messageThreadId,
    boundAt: Date.now(),
    mode: "default",
  };
}

async function ensurePluginConversationBinding(
  ctx: PluginCommandContext,
  bindings: BindingRegistryStore,
  mode: "default" | "companion-exclusive",
): Promise<
  | { record: NonNullable<Awaited<ReturnType<BindingRegistryStore["get"]>>> }
  | { reply: CommandReply }
> {
  const requested = await ctx.requestConversationBinding({
    summary:
      "Allow OpenClaw Travel Companion to own this conversation for travel postcards and delayed chat replies.",
    detachHint:
      "Run /travel-companion deactivate to stop the trip and return this chat to the default assistant.",
  });

  if (requested.status === "pending") {
    return {
      reply: {
        text: [
          "Conversation binding approval is required before takeover can start.",
          `approvalId: ${requested.approvalId}`,
          "Approve it, then run /travel-companion activate again.",
        ].join("\n"),
        isError: true,
      },
    };
  }

  if (requested.status === "error") {
    return {
      reply: {
        text: requested.message,
        isError: true,
      },
    };
  }

  const existing = await bindings.get(
    bindingKey({
      channel: requested.binding.channel,
      accountId: requested.binding.accountId,
      target: requested.binding.conversationId,
      threadId: requested.binding.threadId,
    }),
  );
  const record = {
    ...(existing ?? {}),
    key: bindingKey({
      channel: requested.binding.channel,
      accountId: requested.binding.accountId,
      target: requested.binding.conversationId,
      threadId: requested.binding.threadId,
    }),
    bindingId: requested.binding.bindingId,
    channel: requested.binding.channel,
    accountId: requested.binding.accountId,
    target: requested.binding.conversationId,
    parentConversationId: requested.binding.parentConversationId,
    threadId: requested.binding.threadId,
    boundAt: requested.binding.boundAt,
    mode,
    defaultPersonaId: existing?.defaultPersonaId,
    lastTripId: existing?.lastTripId,
  };
  await bindings.upsert(record);

  return { record };
}

function inferConversationTarget(ctx: PluginCommandContext): string | null {
  const from = normalizeRoutePart(ctx.from ?? ctx.senderId);
  const to = normalizeRoutePart(ctx.to);

  if (ctx.channel === "telegram") {
    if (to?.startsWith("-")) {
      return to;
    }
    return from ?? to;
  }

  return to ?? from;
}

function normalizeRoutePart(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requiredOption(options: Record<string, string>, key: string): string {
  const value = options[key];
  if (!value) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

function parseArgs(rawArgs: string | undefined): ParsedArgs {
  const tokens = tokenize(rawArgs ?? "");
  const subcommand = tokens.shift() ?? "help";
  const options: Record<string, string> = {};

  while (tokens.length > 0) {
    const token = tokens.shift();
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value =
      tokens[0] && !tokens[0]?.startsWith("--") ? tokens.shift() ?? "" : "true";
    options[key] = value;
  }

  return { subcommand, options };
}

function tokenize(input: string): string[] {
  const matches = input.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function helpText(): string {
  return [
    "/travel-companion bind",
    "/travel-companion activate",
    "/travel-companion deactivate",
    "/travel-companion setup --name Mori --traits gentle,curious --relationship soulmate --tone warm --image /abs/path/ref.png",
    "/travel-companion setup --name Mori --traits gentle,curious --relationship soulmate --tone warm --image https://example.com/ref.webp",
    "/travel-companion start --to Tokyo [--from Hong-Kong] [--when next-week]",
    "/travel-companion status [--trip <id>]",
    "/travel-companion tick [--trip <id>]  # force delayed replies + the next trip step immediately",
    "/travel-companion stop [--trip <id>]",
  ].join("\n");
}
