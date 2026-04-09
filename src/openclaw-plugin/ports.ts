import { DeliveryBinding, HostSchedulerPort, Postcard, SendReceipt, TripRepository } from "../domain/types.js";

export class NoopSchedulerPort implements HostSchedulerPort {
  async scheduleTripTick(): Promise<void> {}
}

export interface MessageCommandRunner {
  run(argv: string[]): Promise<{ stdout: string; stderr: string; code: number | null }>;
}

export class OpenClawCliMessengerPort {
  constructor(
    private readonly tripRepository: TripRepository,
    private readonly runner: MessageCommandRunner,
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
    const argv = buildMessageSendArgv(binding, input.postcard);
    const result = await this.runner.run(argv);
    const receipt = extractSendReceipt(result.stdout, result.stderr);

    if (receipt) {
      return receipt;
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
    readString(parsed, "id");
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

function extractJsonRecord(payload: string): Record<string, unknown> | undefined {
  const candidates = payload
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .reverse();

  for (const candidate of candidates) {
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
