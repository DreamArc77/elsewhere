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

    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "openclaw message send failed");
    }

    return {
      messageId: extractMessageId(result.stdout) ?? input.dedupeKey,
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

function extractMessageId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return typeof parsed.messageId === "string" ? parsed.messageId : undefined;
  } catch {
    return undefined;
  }
}
