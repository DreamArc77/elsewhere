import { randomUUID } from "node:crypto";

import {
  ClockPort,
  CompanionReplyPlan,
  CompanionTurn,
  GroundingPort,
  HostMessengerPort,
  HostSchedulerPort,
  ImageGenerationPort,
  ImageGenerationResult,
  InboundUserMessage,
  ItineraryActivity,
  PhaseGroundingResult,
  RuntimeStepContext,
  SendReceipt,
  StoredPersonaProfile,
  TripPlan,
  TripRequest,
} from "../domain/types.js";

function isoDate(dayOffset: number): string {
  const date = new Date(Date.UTC(2026, 3, 12 + dayOffset));
  return date.toISOString().slice(0, 10);
}

function activity(input: {
  time_slot: string;
  location: string;
  address: string;
  type: ItineraryActivity["type"];
  description: string;
  transport_memo: string;
  live_update: string;
}): ItineraryActivity {
  return {
    time_slot: input.time_slot,
    location: input.location,
    address: input.address,
    type: input.type,
    description: input.description,
    transport_memo: input.transport_memo,
    real_time_info: {
      live_update: input.live_update,
    },
  };
}

export function buildFixtureTripPlan(input: {
  tripId: string;
  originCity: string;
  destinationCity: string;
  days: number;
}): TripPlan {
  const daily_itinerary = Array.from({ length: input.days }, (_, index) => {
    const day = index + 1;
    const date = isoDate(index);

    if (day === 1) {
      return {
        day,
        date,
        theme: `Arrival in ${input.destinationCity}`,
        activities: [
          activity({
            time_slot: "13:00 - 14:30",
            location: `${input.destinationCity} Airport Transfer`,
            address: `${input.destinationCity} International Airport`,
            type: "transport",
            description: `Land, clear arrival formalities, and ride into ${input.destinationCity}.`,
            transport_memo: "Airport rail into the city center.",
            live_update: "Arrival hall is busy but moving smoothly.",
          }),
          activity({
            time_slot: "14:45 - 15:30",
            location: `${input.destinationCity} Welcome Lunch`,
            address: `Central Station, ${input.destinationCity}`,
            type: "food",
            description: "Quick first meal after landing.",
            transport_memo: "Five-minute walk from the station exit.",
            live_update: "Lunch queue is short right now.",
          }),
          activity({
            time_slot: "16:00 - 19:00",
            location: `${input.destinationCity} Main Street`,
            address: `1 Central Avenue, ${input.destinationCity}`,
            type: "shopping",
            description: "Ease into the city with a long shopping stroll and lots of photos.",
            transport_memo: "Walkable from the central station.",
            live_update: "Several storefronts are running spring window displays.",
          }),
          activity({
            time_slot: "19:30 - 20:30",
            location: `${input.destinationCity} Night Dinner`,
            address: `8 Lantern Road, ${input.destinationCity}`,
            type: "food",
            description: "A relaxed dinner to settle into the trip.",
            transport_memo: "Ten minutes on foot from Main Street.",
            live_update: "Indoor seating is available without much wait.",
          }),
          activity({
            time_slot: "22:00",
            location: `${input.destinationCity} Central Hotel`,
            address: `99 Harbor View, ${input.destinationCity}`,
            type: "accommodation",
            description: "Check in, shower, and recharge.",
            transport_memo: "Short taxi ride from dinner.",
            live_update: "Late check-in desk is open all night.",
          }),
        ],
      };
    }

    if (day === input.days) {
      return {
        day,
        date,
        theme: `Last day in ${input.destinationCity}`,
        activities: [
          activity({
            time_slot: "09:00 - 11:00",
            location: `${input.destinationCity} Riverside Park`,
            address: `2 River Walk, ${input.destinationCity}`,
            type: "sightseeing",
            description: "One last slow sightseeing stop before heading out.",
            transport_memo: "Local subway from the hotel district.",
            live_update: "Morning light is great for quick photos.",
          }),
          activity({
            time_slot: "11:30 - 12:30",
            location: `${input.destinationCity} Farewell Lunch`,
            address: `12 Station Plaza, ${input.destinationCity}`,
            type: "food",
            description: "A casual final meal in town.",
            transport_memo: "Five-minute walk from the park exit.",
            live_update: "Today there is a lunch set with local specialties.",
          }),
          activity({
            time_slot: "13:00 - 16:30",
            location: `${input.destinationCity} Departure Mall`,
            address: `${input.destinationCity} Airport Terminal 3`,
            type: "shopping",
            description: "Last-minute souvenir shopping and airport browsing.",
            transport_memo: "Airport express directly to Terminal 3.",
            live_update: "Duty-free cosmetics and snacks are well stocked.",
          }),
          activity({
            time_slot: "17:00 - 18:00",
            location: `${input.destinationCity} Airport Dinner`,
            address: `${input.destinationCity} Airport Terminal 3`,
            type: "food",
            description: "A final easy meal before boarding.",
            transport_memo: "Inside the departure terminal.",
            live_update: "Window seats are available with runway views.",
          }),
          activity({
            time_slot: "20:30",
            location: `${input.destinationCity} Airport Gate Lounge`,
            address: `${input.destinationCity} Airport Terminal 3`,
            type: "accommodation",
            description: "Wait at the gate lounge and prepare to fly home.",
            transport_memo: "Walk to the gate after security.",
            live_update: "The return flight is still showing on time.",
          }),
        ],
      };
    }

    return {
      day,
      date,
      theme: `${input.destinationCity} discovery day ${day}`,
      activities: [
        activity({
          time_slot: "09:00 - 12:00",
          location: `${input.destinationCity} Museum Quarter`,
          address: `5 Culture Street, ${input.destinationCity}`,
          type: "sightseeing",
          description: "A long museum visit with plenty of corners to photograph.",
          transport_memo: "Subway ride from the hotel district.",
          live_update: "A seasonal exhibit is drawing a lively crowd.",
        }),
        activity({
          time_slot: "12:15 - 13:15",
          location: `${input.destinationCity} Lunch Market`,
          address: `15 Market Street, ${input.destinationCity}`,
          type: "food",
          description: "A busy lunch stop inside the neighborhood market.",
          transport_memo: "Short walk from the museum quarter.",
          live_update: "Peak lunch rush has just started.",
        }),
        activity({
          time_slot: "13:45 - 16:45",
          location: `${input.destinationCity} Design District`,
          address: `20 Studio Lane, ${input.destinationCity}`,
          type: "shopping",
          description: "Long afternoon in independent shops and concept stores.",
          transport_memo: "One tram ride from the market.",
          live_update: "Several stores have limited local collabs today.",
        }),
        activity({
          time_slot: "17:15 - 18:45",
          location: `${input.destinationCity} Skyline Terrace`,
          address: `88 Summit Road, ${input.destinationCity}`,
          type: "sightseeing",
          description: "Golden-hour sightseeing on a panoramic terrace.",
          transport_memo: "Short taxi uphill from the design district.",
          live_update: "Sunset is expected to be especially clear this evening.",
        }),
        activity({
          time_slot: "19:15 - 20:30",
          location: `${input.destinationCity} Dinner Alley`,
          address: `7 Lantern Court, ${input.destinationCity}`,
          type: "food",
          description: "Dinner in a lively side street full of local spots.",
          transport_memo: "Walk downhill from the terrace.",
          live_update: "Street musicians are performing tonight.",
        }),
        activity({
          time_slot: "22:00",
          location: `${input.destinationCity} Central Hotel`,
          address: `99 Harbor View, ${input.destinationCity}`,
          type: "accommodation",
          description: "Return to the hotel and recharge for tomorrow.",
          transport_memo: "Taxi back to the hotel district.",
          live_update: "Front desk can hold shopping bags overnight.",
        }),
      ],
    };
  });

  return {
    tripId: input.tripId,
    metadata: {
      destination: `${input.destinationCity}, Travel Fixture`,
      days: input.days,
    },
    transportation: {
      outbound: {
        type: "flight",
        identifier: "FX101",
        airline_operator: "Fixture Air",
        departure: {
          airport_station: `${input.originCity} International Airport`,
          time: "08:30",
        },
        arrival: {
          airport_station: `${input.destinationCity} International Airport`,
          time: "12:30",
        },
      },
      return: {
        type: "flight",
        identifier: "FX102",
        airline_operator: "Fixture Air",
        departure: {
          airport_station: `${input.destinationCity} International Airport`,
          time: "21:30",
        },
        arrival: {
          airport_station: `${input.originCity} International Airport`,
          time: "01:10 (+1)",
        },
      },
    },
    search_summary: {
      weather_forecast: `${input.destinationCity} should be mild with a light layer at night.`,
      major_events: [
        `${input.destinationCity} spring market week`,
        `${input.destinationCity} weekend waterfront performances`,
      ],
    },
    daily_itinerary,
  };
}

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
  public readonly sentReplies: Array<{
    dedupeKey: string;
    text: string;
    target: string;
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

  async sendTextReply(input: {
    binding: { target: string };
    text: string;
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
    this.sentReplies.push({
      dedupeKey: input.dedupeKey,
      text: input.text,
      target: input.binding.target,
    });
    return receipt;
  }
}

export class FakeGroundingPort implements GroundingPort {
  constructor(private readonly days = 3) {}

  async planTrip(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
  }): Promise<TripPlan> {
    return buildFixtureTripPlan({
      tripId: input.tripId,
      originCity: input.request.originCity,
      destinationCity: input.request.destinationCity,
      days: this.days,
    });
  }

  async composeCaption(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: RuntimeStepContext["phase"];
    day: number;
    stepContext: RuntimeStepContext;
    grounding: PhaseGroundingResult;
    imagePrompt: string;
  }): Promise<{ caption: string; provider: string }> {
    return {
      caption:
        `${input.persona.name} is at ${input.grounding.locality}. ` +
        `Day ${Math.max(input.day, 1)} ${input.phase}, ` +
        `${input.stepContext.sendMoment} update. ` +
        `Just snapped: ${input.imagePrompt.slice(0, 40)}...`,
      provider: "fake-grounding",
    };
  }

  async composeCompanionReply(input: {
    persona: StoredPersonaProfile | null;
    pendingUserMessages: InboundUserMessage[];
    recentTurns: CompanionTurn[];
  }): Promise<CompanionReplyPlan> {
    const latest = input.pendingUserMessages[input.pendingUserMessages.length - 1];
    return {
      segments: [
        `${input.persona?.name ?? "Companion"} heard: ${latest?.content ?? "..."}`,
      ],
      provider: "fake-grounding",
    };
  }
}

export class FakeImageGenerationPort implements ImageGenerationPort {
  async generateImage(input: {
    phase: RuntimeStepContext["phase"];
    day: number;
    stepContext: RuntimeStepContext;
    shotKind: "selfie" | "snapshot";
    usesReferenceImage: boolean;
  }): Promise<ImageGenerationResult> {
    return {
      mimeType: "image/png",
      bytesBase64: Buffer.from(
        `fake-image-${input.phase}-${input.day}-${input.stepContext.sendMoment}-${input.shotKind}`,
        "utf8",
      ).toString("base64"),
      provider: "fake-image",
      promptEcho: "fixture prompt",
    };
  }
}
