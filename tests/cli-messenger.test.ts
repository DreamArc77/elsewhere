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
});
