import { randomUUID } from "node:crypto";

import {
  ActivityRoute,
  ArrivalContext,
  ClockPort,
  CompanionBusinessSituation,
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
  ResolvedAgentState,
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
  arrival_context: ArrivalContext;
  route?: ActivityRoute;
  live_update: string;
}): ItineraryActivity {
  return {
    time_slot: input.time_slot,
    location: input.location,
    address: input.address,
    type: input.type,
    description: input.description,
    arrival_context: input.arrival_context,
    route: input.route,
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
  const hotelName = `${input.destinationCity} Central Hotel`;
  const airportName = `${input.destinationCity} International Airport`;

  const daily_itinerary = Array.from({ length: input.days }, (_, index) => {
    const day = index + 1;
    const date = isoDate(index);

    if (day === 1) {
      return {
        day,
        date,
        weather_forecast: `${input.destinationCity} should be mild after arrival.`,
        theme: `Arrival in ${input.destinationCity}`,
        activities: [
          activity({
            time_slot: "13:00 - 14:00",
            location: `${airportName} -> ${hotelName}`,
            address: airportName,
            type: "transport",
            description: `Ride from the airport into ${input.destinationCity}.`,
            arrival_context: {
              from_location: airportName,
              transport_mode: "airplane",
              duration_minutes: 0,
            },
            route: {
              from_location: airportName,
              to_location: hotelName,
              transport_mode: "train",
            },
            live_update: "Arrival hall is busy but moving smoothly.",
          }),
          activity({
            time_slot: "14:15 - 15:00",
            location: hotelName,
            address: `99 Harbor View, ${input.destinationCity}`,
            type: "accommodation",
            description: "Check in, drop the bags, and settle in.",
            arrival_context: {
              from_location: `${airportName} -> ${hotelName}`,
              transport_mode: "walk",
              duration_minutes: 5,
            },
            live_update: "Front desk is processing arrivals quickly.",
          }),
          activity({
            time_slot: "15:30 - 16:15",
            location: `${input.destinationCity} Welcome Lunch`,
            address: `Central Station, ${input.destinationCity}`,
            type: "food",
            description: "Quick first meal after landing.",
            arrival_context: {
              from_location: hotelName,
              transport_mode: "walk",
              duration_minutes: 10,
            },
            live_update: "Lunch queue is short right now.",
          }),
          activity({
            time_slot: "16:30 - 19:00",
            location: `${input.destinationCity} Main Street`,
            address: `1 Central Avenue, ${input.destinationCity}`,
            type: "shopping",
            description: "Ease into the city with a long shopping stroll and lots of photos.",
            arrival_context: {
              from_location: `${input.destinationCity} Welcome Lunch`,
              transport_mode: "walk",
              duration_minutes: 10,
            },
            live_update: "Several storefronts are running spring window displays.",
          }),
          activity({
            time_slot: "19:30 - 20:30",
            location: `${input.destinationCity} Night Dinner`,
            address: `8 Lantern Road, ${input.destinationCity}`,
            type: "food",
            description: "A relaxed dinner to settle into the trip.",
            arrival_context: {
              from_location: `${input.destinationCity} Main Street`,
              transport_mode: "walk",
              duration_minutes: 10,
            },
            live_update: "Indoor seating is available without much wait.",
          }),
          activity({
            time_slot: "22:00",
            location: hotelName,
            address: `99 Harbor View, ${input.destinationCity}`,
            type: "accommodation",
            description: "Return to the hotel and recharge.",
            arrival_context: {
              from_location: `${input.destinationCity} Night Dinner`,
              transport_mode: "car",
              duration_minutes: 10,
            },
            live_update: "Late check-in desk is open all night.",
          }),
        ],
      };
    }

    if (day === input.days) {
      return {
        day,
        date,
        weather_forecast: `${input.destinationCity} stays mild before departure.`,
        theme: `Last day in ${input.destinationCity}`,
        activities: [
          activity({
            time_slot: "09:00 - 11:00",
            location: `${input.destinationCity} Riverside Park`,
            address: `2 River Walk, ${input.destinationCity}`,
            type: "sightseeing",
            description: "One last slow sightseeing stop before heading out.",
            arrival_context: {
              from_location: hotelName,
              transport_mode: "subway",
              duration_minutes: 20,
            },
            live_update: "Morning light is great for quick photos.",
          }),
          activity({
            time_slot: "11:30 - 12:30",
            location: `${input.destinationCity} Farewell Lunch`,
            address: `12 Station Plaza, ${input.destinationCity}`,
            type: "food",
            description: "A casual final meal in town.",
            arrival_context: {
              from_location: `${input.destinationCity} Riverside Park`,
              transport_mode: "walk",
              duration_minutes: 5,
            },
            live_update: "Today there is a lunch set with local specialties.",
          }),
          activity({
            time_slot: "13:00 - 13:45",
            location: `${input.destinationCity} Downtown -> ${airportName}`,
            address: airportName,
            type: "transport",
            description: "Take the final ground transfer to the airport before heading home.",
            arrival_context: {
              from_location: `${input.destinationCity} Farewell Lunch`,
              transport_mode: "car",
              duration_minutes: 10,
            },
            route: {
              from_location: `${input.destinationCity} Downtown`,
              to_location: airportName,
              transport_mode: "train",
            },
            live_update: "Allow enough time for check-in and security before the return flight.",
          }),
        ],
      };
    }

    return {
      day,
      date,
      weather_forecast: `${input.destinationCity} stays comfortable with mild weather.`,
      theme: `${input.destinationCity} discovery day ${day}`,
      activities: [
        activity({
          time_slot: "09:00 - 12:00",
          location: `${input.destinationCity} Museum Quarter`,
          address: `5 Culture Street, ${input.destinationCity}`,
          type: "sightseeing",
          description: "A long museum visit with plenty of corners to photograph.",
          arrival_context: {
            from_location: hotelName,
            transport_mode: "subway",
            duration_minutes: 15,
          },
          live_update: "A seasonal exhibit is drawing a lively crowd.",
        }),
        activity({
          time_slot: "12:15 - 13:15",
          location: `${input.destinationCity} Lunch Market`,
          address: `15 Market Street, ${input.destinationCity}`,
          type: "food",
          description: "A busy lunch stop inside the neighborhood market.",
          arrival_context: {
            from_location: `${input.destinationCity} Museum Quarter`,
            transport_mode: "walk",
            duration_minutes: 5,
          },
          live_update: "Peak lunch rush has just started.",
        }),
        activity({
          time_slot: "13:45 - 16:45",
          location: `${input.destinationCity} Design District`,
          address: `20 Studio Lane, ${input.destinationCity}`,
          type: "shopping",
          description: "Long afternoon in independent shops and concept stores.",
          arrival_context: {
            from_location: `${input.destinationCity} Lunch Market`,
            transport_mode: "subway",
            duration_minutes: 10,
          },
          live_update: "Several stores have limited local collabs today.",
        }),
        activity({
          time_slot: "17:15 - 18:45",
          location: `${input.destinationCity} Skyline Terrace`,
          address: `88 Summit Road, ${input.destinationCity}`,
          type: "sightseeing",
          description: "Golden-hour sightseeing on a panoramic terrace.",
          arrival_context: {
            from_location: `${input.destinationCity} Design District`,
            transport_mode: "car",
            duration_minutes: 15,
          },
          live_update: "Sunset is expected to be especially clear this evening.",
        }),
        activity({
          time_slot: "19:15 - 20:30",
          location: `${input.destinationCity} Dinner Alley`,
          address: `7 Lantern Court, ${input.destinationCity}`,
          type: "food",
          description: "Dinner in a lively side street full of local spots.",
          arrival_context: {
            from_location: `${input.destinationCity} Skyline Terrace`,
            transport_mode: "walk",
            duration_minutes: 10,
          },
          live_update: "Street musicians are performing tonight.",
        }),
        activity({
          time_slot: "22:00",
          location: hotelName,
          address: `99 Harbor View, ${input.destinationCity}`,
          type: "accommodation",
          description: "Return to the hotel and recharge for tomorrow.",
          arrival_context: {
            from_location: `${input.destinationCity} Dinner Alley`,
            transport_mode: "car",
            duration_minutes: 10,
          },
          live_update: "Front desk can hold shopping bags overnight.",
        }),
      ],
    };
  });

  return {
    tripId: input.tripId,
    metadata: {
      origin: input.originCity,
      destination: `${input.destinationCity}, Travel Fixture`,
      days: input.days,
    },
    transportation: {
      departure: {
        type: "flight",
        transport_mode: "airplane",
        identifier: "FX101",
        operator: "Fixture Air",
        departure: {
          station: `${input.originCity} International Airport`,
          time: "08:30",
        },
        arrival: {
          station: `${input.destinationCity} International Airport`,
          time: "12:30",
        },
      },
      return: {
        type: "flight",
        transport_mode: "airplane",
        identifier: "FX102",
        operator: "Fixture Air",
        departure: {
          station: `${input.destinationCity} International Airport`,
          time: "21:30",
        },
        arrival: {
          station: `${input.originCity} International Airport`,
          time: "01:10 (+1)",
        },
      },
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
      deliveryMode: "combined",
      fallbackUsed: false,
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
    resolvedState: ResolvedAgentState;
    imageSummary?: string;
  }): Promise<{ caption: string; provider: string }> {
    return {
      caption:
        `${input.persona.name} is at ${input.grounding.locality}. ` +
        `Day ${Math.max(input.day, 1)} ${input.phase}, ` +
        `${input.stepContext.sendMoment} update. ` +
        `Just snapped: ${(input.imageSummary ?? "no-summary").slice(0, 40)}...`,
      provider: "fake-grounding",
    };
  }

  async composeCompanionReply(input: {
    conversationKey: string;
    persona: StoredPersonaProfile | null;
    pendingUserMessages: InboundUserMessage[];
    recentTurns: CompanionTurn[];
    latestPostcardPhoto?: {
      tripId: string;
      sentAt: string;
      shotKind: string;
      caption: string;
      imageSummary?: string;
    };
    activeTrip: unknown | null;
    resolvedState: ResolvedAgentState;
    destinationLoopContext: {
      awaitingDestination: boolean;
      idleEnteredAt?: string | null;
      idleGuideSentAt?: string | null;
      pendingDestinationCandidate?: string | null;
    };
    now: string;
  }): Promise<CompanionReplyPlan> {
    const latest = input.pendingUserMessages[input.pendingUserMessages.length - 1];
    return {
      segments: [
        `${input.persona?.name ?? "Companion"} heard: ${latest?.content ?? "..."}`,
      ],
      provider: "fake-grounding",
    };
  }

  async composeIdleDestinationGuide(input: {
    conversationKey: string;
    persona: StoredPersonaProfile;
    recentTurns: CompanionTurn[];
    resolvedState: ResolvedAgentState;
    now: string;
  }): Promise<{ segments: string[]; provider: string }> {
    return {
      segments: [`${input.persona.name} wants to know where to go next.`],
      provider: "fake-grounding",
    };
  }

  async composeDestinationAcknowledgement(input: {
    conversationKey: string;
    persona: StoredPersonaProfile;
    destination: string;
    recentTurns: CompanionTurn[];
    now: string;
  }): Promise<{ segments: string[]; provider: string }> {
    return {
      segments: [
        `${input.persona.name} will plan ${input.destination} before leaving.`,
      ],
      provider: "fake-grounding",
    };
  }
}

export class FakeImageGenerationPort implements ImageGenerationPort {
  async generateImage(input: {
    tripId: string;
    persona: StoredPersonaProfile;
    request: TripRequest;
    plan: TripPlan;
    phase: RuntimeStepContext["phase"];
    day: number;
    stepContext: RuntimeStepContext;
    grounding: PhaseGroundingResult;
    shotKind: "selfie" | "snapshot";
    usesReferenceImage: boolean;
    prompt: string;
  }): Promise<ImageGenerationResult> {
    return {
      mimeType: "image/png",
      bytesBase64: Buffer.from(
        `fake-image-${input.phase}-${input.day}-${input.stepContext.sendMoment}-${input.shotKind}`,
        "utf8",
      ).toString("base64"),
      provider: "fake-image",
      promptEcho: "fixture prompt",
      imageSummary:
        '{"scene":"fixture scene","otherPeopleVisible":"none","notableDetails":["fixture"]}',
    };
  }
}
