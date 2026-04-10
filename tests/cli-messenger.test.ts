import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";
import { describe, expect, it } from "vitest";

import { OpenClawCliMessengerPort } from "../src/openclaw-plugin/ports.js";
import { TripRepository } from "../src/domain/types.js";

function buildTripRepository(): TripRepository {
  return {
    async save() {},
    async getById() {
      return {
        tripId: "trip-1",
        personaId: "persona-1",
        request: {
          personaId: "persona-1",
          originCity: "Hong Kong",
          destinationCity: "Tokyo",
        },
        plan: {} as never,
        state: {} as never,
        timeline: [],
        timelineIndex: 0,
        pendingDispatch: null,
        deliveryBinding: {
          channel: "telegram",
          target: "12345",
          accountId: "bot-account",
        },
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
      };
    },
    async listDueTrips() {
      return [];
    },
  };
}

describe("OpenClawCliMessengerPort", () => {
  it("treats a parseable JSON receipt as success even if stderr contains warnings", async () => {
    const messenger = new OpenClawCliMessengerPort(buildTripRepository(), {
      async run() {
        return {
          stdout: '{"messageId":"msg-1","provider":"telegram"}',
          stderr:
            'warning: plugin not found: "openclaw-travel-companion" (stale config entry ignored)',
          code: 1,
        };
      },
    });

    const receipt = await messenger.sendPostcard({
      personaId: "persona-1",
      dedupeKey: "trip-1:step-1",
      postcard: {
        tripId: "trip-1",
        phase: "planning",
        caption: "hello",
        imageAsset: "/tmp/fake.png",
        sentAt: "",
      },
    });

    expect(receipt.messageId).toBe("msg-1");
    expect(receipt.provider).toBe("telegram");
  });

  it("throws when no receipt can be extracted from a failed CLI run", async () => {
    const messenger = new OpenClawCliMessengerPort(buildTripRepository(), {
      async run() {
        return {
          stdout: "",
          stderr: "fatal send failure",
          code: 1,
        };
      },
    });

    await expect(
      messenger.sendPostcard({
        personaId: "persona-1",
        dedupeKey: "trip-1:step-1",
        postcard: {
          tripId: "trip-1",
          phase: "planning",
          caption: "hello",
          imageAsset: "/tmp/fake.png",
          sentAt: "",
        },
      }),
    ).rejects.toThrow("fatal send failure");
  });

  it("extracts a nested message id from a noisy pretty-printed CLI payload", async () => {
    const messenger = new OpenClawCliMessengerPort(buildTripRepository(), {
      async run() {
        return {
          stdout: "",
          stderr: [
            "Config warnings:",
            '- plugins.entries.feishu: plugin disabled (disabled in config) but config is present',
            "[plugins] something noisy",
            "{",
            '  "action": "send",',
            '  "channel": "telegram",',
            '  "dryRun": false,',
            '  "handledBy": "plugin",',
            '  "payload": {',
            '    "ok": true,',
            '    "messageId": "149",',
            '    "chatId": "1459473177"',
            "  }",
            "}",
          ].join("\n"),
          code: null,
        };
      },
    });

    const receipt = await messenger.sendPostcard({
      personaId: "persona-1",
      dedupeKey: "trip-1:step-1",
      postcard: {
        tripId: "trip-1",
        phase: "planning",
        caption: "hello",
        imageAsset: "/tmp/fake.png",
        sentAt: "",
      },
    });

    expect(receipt.messageId).toBe("149");
    expect(receipt.provider).toBe("telegram");
  });

  it("treats a timed-out warning-only CLI run as a soft success to avoid duplicate sends", async () => {
    const messenger = new OpenClawCliMessengerPort(buildTripRepository(), {
      async run() {
        return {
          stdout: "",
          stderr: [
            "Config warnings:",
            "- plugins.entries.feishu: plugin disabled (disabled in config) but config is present",
            "• plugins.entries.openclaw-weixin: plugin disabled (disabled in config) but config is present",
            "[plugins] plugins.allow is empty; discovered non-bundled plugins may auto-load: ...",
            "[preload] WARNING: could not find openclaw global installation, symlink not created",
            "[qqbot-remind] Registered QQBot remind tool",
          ].join("\n"),
          code: null,
        };
      },
    });

    const receipt = await messenger.sendPostcard({
      personaId: "persona-1",
      dedupeKey: "trip-1:step-1",
      postcard: {
        tripId: "trip-1",
        phase: "planning",
        caption: "hello",
        imageAsset: "/tmp/fake.png",
        sentAt: "",
      },
    });

    expect(receipt.messageId).toBe("trip-1:step-1");
    expect(receipt.provider).toBe("openclaw-message-cli-timeout");
  });

  it("uses the runtime outbound adapter for text replies without invoking the CLI runner", async () => {
    let runnerCalls = 0;
    const messenger = new OpenClawCliMessengerPort(
      buildTripRepository(),
      {
        async run() {
          runnerCalls += 1;
          return {
            stdout: "",
            stderr: "",
            code: 0,
          };
        },
      },
      {
        runtime: {
          channel: {
            outbound: {
              loadAdapter: async () => ({
                deliveryMode: "direct",
                sendText: async () => ({
                  channel: "telegram",
                  messageId: "fast-1",
                }),
              }),
            },
          },
        } as unknown as PluginRuntime,
        loadConfig: () => ({}) as OpenClawConfig,
      },
    );

    const receipt = await messenger.sendTextReply({
      binding: {
        channel: "telegram",
        target: "1459473177",
        accountId: "1459473177",
      },
      text: "quick bridge reply",
      dedupeKey: "reply-1",
    });

    expect(receipt.messageId).toBe("fast-1");
    expect(receipt.provider).toBe("telegram");
    expect(runnerCalls).toBe(0);
  });
});
