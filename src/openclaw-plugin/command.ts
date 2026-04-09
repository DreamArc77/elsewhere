import type { PluginCommandContext } from "openclaw/plugin-sdk/plugin-entry";

import { OpenClawTravelCompanionService } from "../application/openclaw-travel-companion-service.js";
import { TripRecord, TripRepository } from "../domain/types.js";
import { BindingRegistryStore, bindingKey } from "./binding-state.js";
import { TravelCompanionPluginConfig } from "./config.js";

type CommandReply = { text: string; isError?: boolean };

interface CommandDependencies {
  service: OpenClawTravelCompanionService;
  tripRepository: TripRepository;
  bindings: BindingRegistryStore;
  pluginConfig: TravelCompanionPluginConfig;
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
    case "setup":
      return setupPersona(ctx, parsed.options, deps);
    case "start":
      return startTrip(ctx, parsed.options, deps);
    case "status":
      return statusTrip(ctx, parsed.options, deps);
    case "tick":
      return tickTrip(ctx, parsed.options, deps);
    default:
      return { text: helpText() };
  }
}

async function bindConversation(
  ctx: PluginCommandContext,
  bindings: BindingRegistryStore,
): Promise<CommandReply> {
  const existing = await ctx.getCurrentConversationBinding();
  if (existing) {
    const key = bindingKey({
      channel: existing.channel,
      accountId: existing.accountId,
      target: existing.conversationId,
      threadId: existing.threadId,
    });
    await bindings.upsert({
      key,
      bindingId: existing.bindingId,
      channel: existing.channel,
      accountId: existing.accountId,
      target: existing.conversationId,
      parentConversationId: existing.parentConversationId,
      threadId: existing.threadId,
      boundAt: existing.boundAt,
    });
    return {
      text: "This conversation is already bound. Travel postcards will return here.",
    };
  }

  const requested = await ctx.requestConversationBinding({
    summary: "Allow OpenClaw Travel Companion to proactively send trip postcards here.",
    detachHint:
      "Use /travel-companion bind again in another chat to move postcard delivery.",
  });

  if (requested.status === "pending") {
    return requested.reply as CommandReply;
  }
  if (requested.status === "error") {
    return { text: requested.message, isError: true };
  }

  const binding = requested.binding;
  const key = bindingKey({
    channel: binding.channel,
    accountId: binding.accountId,
    target: binding.conversationId,
    threadId: binding.threadId,
  });
  await bindings.upsert({
    key,
    bindingId: binding.bindingId,
    channel: binding.channel,
    accountId: binding.accountId,
    target: binding.conversationId,
    parentConversationId: binding.parentConversationId,
    threadId: binding.threadId,
    boundAt: binding.boundAt,
  });

  return {
    text: [
      "Binding complete.",
      "Next run /travel-companion setup to create the persona.",
      "Then run /travel-companion start --to <city>.",
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

  const persona = await deps.service.createPersona({
    name: requiredOption(options, "name"),
    traits: requiredOption(options, "traits")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    relationship: requiredOption(options, "relationship"),
    toneStyle: requiredOption(options, "tone"),
    referenceImageAsset: requiredOption(options, "image"),
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
      `Days: ${patchedTrip.plan.days}`,
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
  if (!tripId) {
    return { text: "No trip is available to tick.", isError: true };
  }

  const trip = await deps.service.runTrip(tripId);
  return {
    text: [
      `Ticked: ${trip.tripId}`,
      `status: ${trip.state.status}`,
      `phase: ${trip.state.currentPhase}`,
      `nextRunAt: ${trip.state.nextRunAt ?? "none"}`,
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
  const current = await ctx.getCurrentConversationBinding();
  if (!current) {
    return {
      reply: {
        text: "This conversation is not bound yet. Run /travel-companion bind first.",
        isError: true,
      },
    };
  }

  const key = bindingKey({
    channel: current.channel,
    accountId: current.accountId,
    target: current.conversationId,
    threadId: current.threadId,
  });
  const record = await bindings.get(key);
  if (record) {
    return { record };
  }

  const newRecord = {
    key,
    bindingId: current.bindingId,
    channel: current.channel,
    accountId: current.accountId,
    target: current.conversationId,
    parentConversationId: current.parentConversationId,
    threadId: current.threadId,
    boundAt: current.boundAt,
  };
  await bindings.upsert(newRecord);
  return { record: newRecord };
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
    "/travel-companion setup --name Mori --traits gentle,curious --relationship soulmate --tone warm --image /abs/path/ref.png",
    "/travel-companion start --to Tokyo [--from Hong-Kong] [--when next-week]",
    "/travel-companion status [--trip <id>]",
    "/travel-companion tick [--trip <id>]",
  ].join("\n");
}
