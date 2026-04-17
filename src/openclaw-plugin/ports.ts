import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";

import {
  ChannelCapabilitySummary,
  DeliveryBinding,
  HostSchedulerPort,
  LoggerPort,
  Postcard,
  PostcardDeliveryMode,
  SendReceipt,
  TripRepository,
} from "../domain/types.js";
import {
  getChannelCapabilities,
  supportsCombinedPostcard,
  supportsMediaPostcard,
} from "./channel-capabilities.js";

export class NoopSchedulerPort implements HostSchedulerPort {
  async scheduleTripTick(): Promise<void> {}
}

export interface MessageCommandRunner {
  run(argv: string[]): Promise<{ stdout: string; stderr: string; code: number | null }>;
}

export interface DirectReplyRuntime {
  runtime?: PluginRuntime;
  loadConfig(): OpenClawConfig;
}

type LoadChannelOutboundAdapter = (
  id: string,
) => Promise<{
  deliveryMode: "direct" | "gateway" | "hybrid";
  sendText?: (ctx: {
    cfg: OpenClawConfig;
    to: string;
    text: string;
    accountId?: string | null;
    threadId?: string | number | null;
  }) => Promise<{ channel?: string; messageId: string }>;
  sendPayload?: (ctx: {
    cfg: OpenClawConfig;
    to: string;
    text: string;
    payload: { text: string };
    accountId?: string | null;
    threadId?: string | number | null;
  }) => Promise<{ channel?: string; messageId: string }>;
} | undefined>;

let outboundAdapterLoaderPromise: Promise<LoadChannelOutboundAdapter> | undefined;

export class OpenClawCliMessengerPort {
  constructor(
    private readonly tripRepository: TripRepository,
    private readonly runner: MessageCommandRunner,
    private readonly directReplyRuntime?: DirectReplyRuntime,
    private readonly logger?: LoggerPort,
  ) {}

  async sendPostcard(input: {
    personaId: string;
    postcard: Postcard;
    dedupeKey: string;
  }): Promise<SendReceipt> {
    const trip = await this.tripRepository.getById(input.postcard.tripId);
    if (!trip?.deliveryBinding) {
      throw new Error(`Trip ${input.postcard.tripId} is missing a delivery binding.`);
    }

    const binding = trip.deliveryBinding;
    const channelCapabilities = getChannelCapabilities(binding.channel);
    const runId = `postcard:${input.dedupeKey}`;
    const startedAtMs = Date.now();
    let combinedFailureReason = "combined_delivery_unavailable";
    let lastError: Error | undefined;

    if (supportsCombinedPostcard(binding.channel)) {
      try {
        const receipt = await this.runCliSend({
          argv: buildMessageSendArgv(binding, input.postcard),
          dedupeKey: input.dedupeKey,
          timeoutProvider: "openclaw-message-cli-timeout",
        });
        await this.logPostcardEvent({
          binding,
          runId,
          event: "postcard.delivery.combined.sent",
          decision: "Delivered postcard as one combined image+caption message.",
          provider: receipt.provider,
          status: "success",
          startedAtMs,
          details: {
            dedupeKey: input.dedupeKey,
            deliveryMode: "combined",
            messageId: receipt.messageId,
            channelCapabilities,
          },
        });
        return decoratePostcardReceipt(receipt, {
          deliveryMode: "combined",
          fallbackUsed: false,
          channelCapabilities,
        });
      } catch (error) {
        combinedFailureReason =
          error instanceof Error ? error.message : String(error);
        lastError =
          error instanceof Error ? error : new Error(combinedFailureReason);
        await this.logPostcardEvent({
          binding,
          runId,
          event: "postcard.delivery.combined.failed",
          decision:
            "Combined postcard delivery failed; trying a downgraded fallback path.",
          provider: "openclaw-message-cli",
          status: "failure",
          startedAtMs,
          errorCode:
            error instanceof Error ? error.name : "postcard_combined_failed",
          details: {
            dedupeKey: input.dedupeKey,
            deliveryMode: "combined",
            channelCapabilities,
            errorMessage: combinedFailureReason,
          },
        });
      }
    } else {
      combinedFailureReason = "channel_combined_postcard_unsupported";
      await this.logPostcardEvent({
        binding,
        runId,
        event: "postcard.delivery.combined.skipped",
        decision:
          "Skipped combined postcard delivery because this channel is marked unsupported for image+caption posts.",
        provider: "openclaw-message-cli",
        status: "skipped",
        startedAtMs,
        details: {
          dedupeKey: input.dedupeKey,
          deliveryMode: "combined",
          channelCapabilities,
        },
      });
    }

    if (supportsMediaPostcard(binding.channel)) {
      try {
        const mediaReceipt = await this.runCliSend({
          argv: buildMediaSendArgv(binding, input.postcard.imageAsset),
          dedupeKey: `${input.dedupeKey}:media`,
          timeoutProvider: "openclaw-message-cli-timeout",
        });
        const captionReceipt = await this.sendTextReply({
          binding,
          text: input.postcard.caption,
          dedupeKey: `${input.dedupeKey}:caption`,
        });
        const splitReceipt: SendReceipt = {
          messageId: mediaReceipt.messageId,
          deduped: mediaReceipt.deduped && captionReceipt.deduped,
          provider: mediaReceipt.provider,
          deliveryMode: "split",
          fallbackUsed: true,
          fallbackReason: combinedFailureReason,
          auxiliaryMessageIds: [captionReceipt.messageId],
          channelCapabilities,
        };
        await this.logPostcardEvent({
          binding,
          runId,
          event: "postcard.delivery.split.sent",
          decision:
            "Delivered postcard as split media then text after combined delivery was unavailable.",
          provider: mediaReceipt.provider,
          status: "success",
          startedAtMs,
          details: {
            dedupeKey: input.dedupeKey,
            deliveryMode: "split",
            messageId: mediaReceipt.messageId,
            auxiliaryMessageIds: splitReceipt.auxiliaryMessageIds,
            fallbackReason: combinedFailureReason,
            channelCapabilities,
          },
        });
        return splitReceipt;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(String(error));
        await this.logPostcardEvent({
          binding,
          runId,
          event: "postcard.delivery.split.failed",
          decision:
            "Split postcard delivery failed; trying text-only fallback next.",
          provider: "openclaw-message-cli",
          status: "failure",
          startedAtMs,
          errorCode:
            error instanceof Error ? error.name : "postcard_split_failed",
          details: {
            dedupeKey: input.dedupeKey,
            deliveryMode: "split",
            fallbackReason: combinedFailureReason,
            channelCapabilities,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      }
    } else {
      await this.logPostcardEvent({
        binding,
        runId,
        event: "postcard.delivery.split.skipped",
        decision:
          "Skipped split postcard delivery because this channel is marked unsupported for media messages.",
        provider: "openclaw-message-cli",
        status: "skipped",
        startedAtMs,
        details: {
          dedupeKey: input.dedupeKey,
          deliveryMode: "split",
          fallbackReason: combinedFailureReason,
          channelCapabilities,
        },
      });
    }

    try {
      const textReceipt = await this.sendTextReply({
        binding,
        text: input.postcard.caption,
        dedupeKey: `${input.dedupeKey}:text-only`,
      });
      const finalReceipt = decoratePostcardReceipt(textReceipt, {
        deliveryMode: "text-only",
        fallbackUsed: true,
        fallbackReason: supportsMediaPostcard(binding.channel)
          ? `${combinedFailureReason};split_delivery_failed`
          : `${combinedFailureReason};channel_media_postcard_unsupported`,
        channelCapabilities,
      });
      await this.logPostcardEvent({
        binding,
        runId,
        event: "postcard.delivery.text_only.sent",
        decision:
          "Delivered postcard as text-only fallback after richer delivery modes were unavailable.",
        provider: textReceipt.provider,
        status: "success",
        startedAtMs,
        details: {
          dedupeKey: input.dedupeKey,
          deliveryMode: "text-only",
          messageId: textReceipt.messageId,
          fallbackReason: finalReceipt.fallbackReason,
          channelCapabilities,
        },
      });
      return finalReceipt;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error));
      await this.logPostcardEvent({
        binding,
        runId,
        event: "postcard.delivery.text_only.failed",
        decision:
          "Text-only postcard fallback also failed; preserving pending state for retry.",
        provider: "openclaw-message-cli",
        status: "failure",
        startedAtMs,
        errorCode:
          error instanceof Error ? error.name : "postcard_text_only_failed",
        details: {
          dedupeKey: input.dedupeKey,
          deliveryMode: "text-only",
          channelCapabilities,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }

    throw lastError ?? new Error("Postcard delivery failed after all fallbacks.");
  }

  async sendTextReply(input: {
    binding: DeliveryBinding;
    text: string;
    dedupeKey: string;
  }): Promise<SendReceipt> {
    const directSendStartedAt = Date.now();
    const directReceipt = await this.trySendDirectTextReply(
      input.binding,
      input.text,
      input.dedupeKey,
      directSendStartedAt,
    );
    if (directReceipt) {
      return directReceipt;
    }

    await this.logTextReplyEvent({
      binding: input.binding,
      runId: `text-reply:${input.dedupeKey}`,
      event: "textreply.cli.fallback",
      decision:
        "Fell back to CLI text reply delivery after direct outbound path was unavailable.",
      provider: "openclaw-message-cli",
      status: "success",
      startedAtMs: directSendStartedAt,
      details: {
        dedupeKey: input.dedupeKey,
      },
    });

    const argv = buildTextSendArgv(input.binding, input.text);
    const result = await this.runner.run(argv);
    const receipt = extractSendReceipt(result.stdout, result.stderr);

    if (receipt) {
      return receipt;
    }

    if (
      result.code === null &&
      containsOnlyBenignCliNoise(result.stdout, result.stderr)
    ) {
      return {
        messageId: input.dedupeKey,
        deduped: false,
        provider: "openclaw-message-cli-timeout",
      };
    }

    if (result.code !== 0) {
      throw new Error(
        [
          "openclaw message send failed",
          `code=${result.code ?? "null"}`,
          result.stderr?.trim(),
          result.stdout?.trim(),
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }

    return {
      messageId: input.dedupeKey,
      deduped: false,
      provider: "openclaw-message-cli",
    };
  }

  private async trySendDirectTextReply(
    binding: DeliveryBinding,
    text: string,
    dedupeKey: string,
    startedAtMs: number,
  ): Promise<SendReceipt | undefined> {
    if (!this.directReplyRuntime) {
      await this.logTextReplyEvent({
        binding,
        runId: `text-reply:${dedupeKey}`,
        event: "textreply.direct.unavailable",
        decision:
          "Direct reply runtime was not available; CLI fallback is required.",
        provider: "runtime-outbound",
        status: "skipped",
        startedAtMs,
        details: {
          dedupeKey,
          reason: "missing_direct_reply_runtime",
        },
      });
      return undefined;
    }

    try {
      const cfg = this.directReplyRuntime.loadConfig();
      const adapter =
        (await this.directReplyRuntime.runtime?.channel?.outbound?.loadAdapter?.(
          binding.channel,
        )) ?? (await resolveOutboundAdapterLoader(binding.channel));
      if (!adapter) {
        await this.logTextReplyEvent({
          binding,
          runId: `text-reply:${dedupeKey}`,
          event: "textreply.direct.unavailable",
          decision: "No direct outbound adapter was available for this channel.",
          provider: "runtime-outbound",
          status: "skipped",
          startedAtMs,
          details: {
            dedupeKey,
            reason: "missing_outbound_adapter",
            channel: binding.channel,
          },
        });
        return undefined;
      }

      if (adapter.sendText) {
        const result = await adapter.sendText({
          cfg,
          to: binding.target,
          text,
          accountId: binding.accountId ?? null,
          threadId: binding.threadId ?? null,
        });

        const receipt = {
          messageId: result.messageId,
          deduped: false,
          provider: result.channel ?? binding.channel,
        };
        await this.logTextReplyEvent({
          binding,
          runId: `text-reply:${dedupeKey}`,
          event: "textreply.direct.sent",
          decision:
            "Delivered text reply through the runtime outbound adapter sendText path.",
          provider: result.channel ?? binding.channel,
          status: "success",
          startedAtMs,
          details: {
            dedupeKey,
            channel: binding.channel,
            deliveryMode: adapter.deliveryMode,
            method: "sendText",
            messageId: result.messageId,
          },
        });
        return receipt;
      }

      if (adapter.sendPayload) {
        const result = await adapter.sendPayload({
          cfg,
          to: binding.target,
          text,
          payload: { text },
          accountId: binding.accountId ?? null,
          threadId: binding.threadId ?? null,
        });

        const receipt = {
          messageId: result.messageId,
          deduped: false,
          provider: result.channel ?? binding.channel,
        };
        await this.logTextReplyEvent({
          binding,
          runId: `text-reply:${dedupeKey}`,
          event: "textreply.direct.sent",
          decision:
            "Delivered text reply through the runtime outbound adapter sendPayload path.",
          provider: result.channel ?? binding.channel,
          status: "success",
          startedAtMs,
          details: {
            dedupeKey,
            channel: binding.channel,
            deliveryMode: adapter.deliveryMode,
            method: "sendPayload",
            messageId: result.messageId,
          },
        });
        return receipt;
      }

      await this.logTextReplyEvent({
        binding,
        runId: `text-reply:${dedupeKey}`,
        event: "textreply.direct.unavailable",
        decision:
          "Runtime outbound adapter did not expose sendText or sendPayload.",
        provider: "runtime-outbound",
        status: "skipped",
        startedAtMs,
        details: {
          dedupeKey,
          channel: binding.channel,
          deliveryMode: adapter.deliveryMode,
          reason: "adapter_missing_text_methods",
        },
      });
    } catch (error) {
      await this.logTextReplyEvent({
        binding,
        runId: `text-reply:${dedupeKey}`,
        event: "textreply.direct.failed",
        decision: "Direct runtime outbound send failed; CLI fallback is required.",
        provider: "runtime-outbound",
        status: "failure",
        startedAtMs,
        errorCode:
          error instanceof Error ? error.name : "direct_text_reply_failed",
        details: {
          dedupeKey,
          channel: binding.channel,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      return undefined;
    }

    return undefined;
  }

  private async logTextReplyEvent(input: {
    binding: DeliveryBinding;
    runId: string;
    event: string;
    decision: string;
    provider: string;
    status: "success" | "failure" | "skipped";
    startedAtMs: number;
    errorCode?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.logger) {
      return;
    }

    const finishedAtMs = Date.now();
    await this.logger.log({
      tripId: `conversation:${conversationLogKey(input.binding)}`,
      runId: input.runId,
      phase: "system",
      event: input.event,
      decision: input.decision,
      provider: input.provider,
      status: input.status,
      startedAt: new Date(input.startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      latencyMs: Math.max(0, finishedAtMs - input.startedAtMs),
      errorCode: input.errorCode,
      details: {
        conversationKey: conversationLogKey(input.binding),
        ...(input.details ?? {}),
      },
    });
  }

  private async logPostcardEvent(input: {
    binding: DeliveryBinding;
    runId: string;
    event: string;
    decision: string;
    provider: string;
    status: "success" | "failure" | "skipped";
    startedAtMs: number;
    errorCode?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.logger) {
      return;
    }

    const finishedAtMs = Date.now();
    await this.logger.log({
      tripId: `conversation:${conversationLogKey(input.binding)}`,
      runId: input.runId,
      phase: "system",
      event: input.event,
      decision: input.decision,
      provider: input.provider,
      status: input.status,
      startedAt: new Date(input.startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      latencyMs: Math.max(0, finishedAtMs - input.startedAtMs),
      errorCode: input.errorCode,
      details: {
        conversationKey: conversationLogKey(input.binding),
        ...(input.details ?? {}),
      },
    });
  }

  private async runCliSend(input: {
    argv: string[];
    dedupeKey: string;
    timeoutProvider: string;
  }): Promise<SendReceipt> {
    const result = await this.runner.run(input.argv);
    const receipt = extractSendReceipt(result.stdout, result.stderr);

    if (receipt) {
      return receipt;
    }

    if (
      result.code === null &&
      containsOnlyBenignCliNoise(result.stdout, result.stderr)
    ) {
      return {
        messageId: input.dedupeKey,
        deduped: false,
        provider: input.timeoutProvider,
      };
    }

    if (result.code !== 0) {
      throw new Error(
        [
          "openclaw message send failed",
          `code=${result.code ?? "null"}`,
          result.stderr?.trim(),
          result.stdout?.trim(),
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }

    return {
      messageId: input.dedupeKey,
      deduped: false,
      provider: "openclaw-message-cli",
    };
  }
}

async function resolveOutboundAdapterLoader(
  id: string,
): Promise<Awaited<ReturnType<LoadChannelOutboundAdapter>>> {
  outboundAdapterLoaderPromise ??= loadOutboundAdapterLoader();
  const loader = await outboundAdapterLoaderPromise;
  return loader(id);
}

async function loadOutboundAdapterLoader(): Promise<LoadChannelOutboundAdapter> {
  const require = createRequire(import.meta.url);
  const entryPath = require.resolve("openclaw");
  const distDir = dirname(entryPath);
  const fs = await import("node:fs/promises");
  const candidates = (await fs.readdir(distDir))
    .filter((name) => /^load-.*\.js$/u.test(name) && !/^load-options-/u.test(name))
    .sort();
  const fileName = candidates[0];
  if (!fileName) {
    throw new Error("Unable to locate OpenClaw outbound loader module.");
  }

  const moduleUrl = pathToFileURL(join(distDir, fileName)).href;
  const module = await import(moduleUrl);
  const loader = module.t as LoadChannelOutboundAdapter | undefined;
  if (!loader) {
    throw new Error("OpenClaw outbound loader module did not export a loader.");
  }
  return loader;
}

function conversationLogKey(binding: DeliveryBinding): string {
  return [
    binding.channel,
    binding.accountId ?? "default",
    binding.target,
    binding.threadId === undefined ? "main" : String(binding.threadId),
  ].join("::");
}

const benignCliNoisePatterns = [
  /^Config warnings:/u,
  /^- plugins\.entries\./u,
  /^• plugins\.entries\./u,
  /^\[plugins\]/u,
  /^\[preload\] WARNING:/u,
  /^\[qqbot-/u,
  /^Set plugins\.allow to explicit trusted ids\./u,
  /^$/u,
] as const;

function containsOnlyBenignCliNoise(stdout: string, stderr: string): boolean {
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (!combined) {
    return false;
  }

  const lines = combined.split(/\r?\n/u).map((line) => line.trim());
  return lines.every((line) =>
    benignCliNoisePatterns.some((pattern) => pattern.test(line)),
  );
}

function buildMessageSendArgv(
  binding: DeliveryBinding,
  postcard: Postcard,
): string[] {
  const argv = [
    "message",
    "send",
    "--channel",
    binding.channel,
    "--target",
    binding.target,
    "--message",
    postcard.caption,
    "--media",
    postcard.imageAsset,
    "--json",
  ];

  if (binding.accountId) {
    argv.push("--account", binding.accountId);
  }
  if (binding.threadId !== undefined) {
    argv.push("--thread-id", String(binding.threadId));
  }

  return argv;
}

function buildTextSendArgv(binding: DeliveryBinding, text: string): string[] {
  const argv = [
    "message",
    "send",
    "--channel",
    binding.channel,
    "--target",
    binding.target,
    "--message",
    text,
    "--json",
  ];

  if (binding.accountId) {
    argv.push("--account", binding.accountId);
  }
  if (binding.threadId !== undefined) {
    argv.push("--thread-id", String(binding.threadId));
  }

  return argv;
}

function buildMediaSendArgv(binding: DeliveryBinding, mediaAsset: string): string[] {
  const argv = [
    "message",
    "send",
    "--channel",
    binding.channel,
    "--target",
    binding.target,
    "--media",
    mediaAsset,
    "--json",
  ];

  if (binding.accountId) {
    argv.push("--account", binding.accountId);
  }
  if (binding.threadId !== undefined) {
    argv.push("--thread-id", String(binding.threadId));
  }

  return argv;
}

function extractSendReceipt(
  stdout: string,
  stderr: string,
): SendReceipt | undefined {
  const payload = [stdout, stderr].filter(Boolean).join("\n");
  const parsed = extractJsonRecord(payload);
  if (!parsed) {
    return undefined;
  }

  const messageId =
    readString(parsed, "messageId") ??
    readString(parsed, "message_id") ??
    readString(parsed, "id") ??
    readNestedString(parsed, ["payload", "messageId"]) ??
    readNestedString(parsed, ["payload", "message_id"]) ??
    readNestedString(parsed, ["payload", "id"]);
  const deduped =
    readBoolean(parsed, "deduped") ??
    readBoolean(parsed, "duplicate") ??
    false;

  if (!messageId) {
    return undefined;
  }

  return {
    messageId,
    deduped,
    provider:
      readString(parsed, "provider") ??
      readString(parsed, "channel") ??
      "openclaw-message-cli",
  };
}

function decoratePostcardReceipt(
  receipt: SendReceipt,
  input: {
    deliveryMode: PostcardDeliveryMode;
    fallbackUsed: boolean;
    fallbackReason?: string;
    auxiliaryMessageIds?: string[];
    channelCapabilities: ChannelCapabilitySummary;
  },
): SendReceipt {
  return {
    ...receipt,
    deliveryMode: input.deliveryMode,
    fallbackUsed: input.fallbackUsed,
    fallbackReason: input.fallbackReason,
    auxiliaryMessageIds: input.auxiliaryMessageIds,
    channelCapabilities: input.channelCapabilities,
  };
}

function extractJsonRecord(payload: string): Record<string, unknown> | undefined {
  for (const candidate of extractBalancedJsonObjects(payload).reverse()) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      return parsed;
    } catch {
      continue;
    }
  }

  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractBalancedJsonObjects(payload: string): string[] {
  const matches: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        matches.push(payload.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return matches;
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === "string" ? (value[key] as string) : undefined;
}

function readBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  return typeof value[key] === "boolean"
    ? (value[key] as boolean)
    : undefined;
}

function readNestedString(
  value: Record<string, unknown>,
  path: string[],
): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : undefined;
}
