import { randomUUID } from "node:crypto";

import {
  ClockPort,
  GroundingPort,
  HostMessengerPort,
  HostSchedulerPort,
  ImageGenerationPort,
  ImageGenerationResult,
  PhaseGroundingResult,
  SendReceipt,
  StoredPersonaProfile,
  TripPhase,
  TripPlan,
  TripRequest,
} from "../domain/types.js";

export class FakeClock implements ClockPort {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 60 * 60 * 1000);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}

export class FakeScheduler implements HostSchedulerPort {
  public readonly scheduled: Array<{ tripId: string; runAt: string }> = [];

  async scheduleTripTick(input: {
    tripId: string;
    runAt: string;
  }): Promise<void> {
    this.scheduled.push(input);
  }
}

export class FakeMessenger implements HostMessengerPort {
  public readonly receipts = new Map<string, SendReceipt>();
  public readonly sentMessages: Array<{
    personaId: string;
    dedupeKey: string;
    caption: string;
  }> = [];
  public rawSendAttempts = 0;

  async sendPostcard(input: {
    personaId: string;
    postcard: { caption: string };
    dedupeKey: string;
  }): Promise<SendReceipt> {
    this.rawSendAttempts += 1;
    const existing = this.receipts.get(input.dedupeKey);
    if (existing) {
      return {
        ...existing,
        deduped: true,
      };
    }

    const receipt: SendReceipt = {
      messageId: randomUUID(),
      deduped: false,
      provider: "fake-messenger",
    };
    this.receipts.set(input.dedupeKey, receipt);
    this.sentMessages.push({
      personaId: input.personaId,
      dedupeKey: input.dedupeKey,
      caption: input.postcard.caption,
    });
    return receipt;
  }
}

function recommendedPostingMoments(): TripPhase[] {
  return [
    "planning",
    "departing",
    "arrival_checkin",
    "day_exploration",
    "returning",
    "home_reflection",
  ];
}

export class FakeGroundingPort implements GroundingPort {
  constructor(private readonly days = 3) {}

  async planTrip(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
  }): Promise<TripPlan> {
    return {
      tripId: input.tripId,
      days: this.days,
      transport: {
        summary: `${input.request.originCity} to ${input.request.destinationCity} daytime flight`,
        departure: `${input.request.originCity} International Airport`,
        arrival: `${input.request.destinationCity} International Airport`,
        carrierHint: "Fixture Air",
      },
      hotel: {
        name: `${input.request.destinationCity} Central Hotel`,
        district: "City Center",
        nightlyBudget: "USD 220",
      },
      dailyAgenda: Array.from({ length: this.days }, (_, index) => ({
        day: index + 1,
        dateLabel: `Day ${index + 1}`,
        headline: `${input.request.destinationCity} highlights ${index + 1}`,
        morning: [`Morning coffee stop ${index + 1}`],
        afternoon: [`Museum visit ${index + 1}`],
        evening: [`Night walk ${index + 1}`],
        notes: `Slow pace with time for photos on day ${index + 1}.`,
      })),
      groundingSources: [
        {
          title: `${input.request.destinationCity} tourism board`,
          uri: "https://example.com/tourism",
        },
      ],
      weatherSummary: "Warm days and breezy evenings.",
      recommendedPostingMoments: recommendedPostingMoments(),
    };
  }

  async enrichPhase(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
  }): Promise<PhaseGroundingResult> {
    return {
      phase: input.phase,
      day: input.day,
      locality:
        input.phase === "day_exploration"
          ? `${input.request.destinationCity} old town`
          : `${input.request.destinationCity} transit district`,
      weatherSummary: `Clear skies during ${input.phase}.`,
      transitSummary: `Transit feels smooth for ${input.phase}.`,
      venueSummary: `Best known local spot for ${input.phase}.`,
      photoBrief: `A candid phone selfie during ${input.phase}.`,
      sensoryHighlights: ["soft wind", "street chatter", "coffee aroma"],
      groundingSources: [
        {
          title: `${input.phase} local guide`,
          uri: `https://example.com/${input.phase}`,
        },
      ],
    };
  }

  async composeCaption(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: TripPhase;
    day: number;
    grounding: PhaseGroundingResult;
  }): Promise<{ caption: string; provider: string }> {
    return {
      caption: `${input.persona.name}在${input.grounding.locality}，第${Math.max(
        input.day,
        1,
      )}天的${input.phase}很像真的出远门了。`,
      provider: "fake-grounding",
    };
  }
}

export class FakeImageGenerationPort implements ImageGenerationPort {
  async generateImage(input: {
    phase: TripPhase;
    day: number;
  }): Promise<ImageGenerationResult> {
    return {
      mimeType: "image/png",
      bytesBase64: Buffer.from(
        `fake-image-${input.phase}-${input.day}`,
        "utf8",
      ).toString("base64"),
      provider: "fake-image",
      promptEcho: "fixture prompt",
    };
  }
}
