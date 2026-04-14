import { randomUUID } from "node:crypto";

import {
  ClockPort,
  CompanionReplyPlan,
  CompanionBusinessSituation,
  ConversationBindingRecord,
  ConversationBindingStore,
  ConversationCompanionState,
  ConversationStateRepository,
  GroundingPort,
  HostMessengerPort,
  LogEntry,
  LoggerPort,
  PersonaRepository,
  StoredPersonaProfile,
  TripRecord,
  TripRepository,
} from "../domain/types.js";
import {
  createReplyHotWindow,
  deriveCompanionBusinessSituation,
  deriveReplyDueAt,
} from "../domain/business-situation.js";

function nowIso(clock: ClockPort): string {
  return clock.now().toISOString();
}

function elapsedMs(startedAt: string, finishedAt: string): number {
  return new Date(finishedAt).getTime() - new Date(startedAt).getTime();
}

function trimTurns<T>(items: T[], max: number): T[] {
  return items.slice(Math.max(0, items.length - max));
}

function trimRecentMessageIds(items: string[], max: number): string[] {
  return items.slice(Math.max(0, items.length - max));
}

function filterReplyTurnsForActiveTrip(
  turns: ConversationCompanionState["recentTurns"],
  activeTrip: TripRecord | null,
): ConversationCompanionState["recentTurns"] {
  if (!activeTrip) {
    return trimTurns(turns, 12);
  }

  const tripCreatedAt = new Date(activeTrip.createdAt).getTime();
  return trimTurns(
    turns.filter(
      (turn) =>
        turn.tripId === activeTrip.tripId ||
        new Date(turn.createdAt).getTime() >= tripCreatedAt,
    ),
    12,
  );
}

function emptyConversationState(
  conversationKey: string,
  mode: ConversationBindingRecord["mode"],
  updatedAt: string,
): ConversationCompanionState {
  return {
    conversationKey,
    mode,
    pendingUserMessages: [],
    pendingReplyDispatch: null,
    instantReplyWindow: null,
    recentHandledCommandMessageIds: [],
    recentTurns: [],
    lastUserMessageAt: null,
    lastCompanionReplyAt: null,
    memorySummary: undefined,
    updatedAt,
  };
}

export class CompanionConversationService {
  private readonly inFlightConversationKeys = new Set<string>();

  constructor(
    private readonly dependencies: {
      bindings: ConversationBindingStore;
      conversationStates: ConversationStateRepository;
      tripRepository: TripRepository;
      personaRepository: PersonaRepository;
      grounding: GroundingPort;
      messenger: HostMessengerPort;
      clock: ClockPort;
      logger: LoggerPort;
    },
  ) {}

  async activateConversation(
    binding: ConversationBindingRecord,
  ): Promise<ConversationCompanionState> {
    const startedAt = nowIso(this.dependencies.clock);
    const runId = randomUUID();
    const updatedAt = nowIso(this.dependencies.clock);
    const state =
      (await this.dependencies.conversationStates.getByKey(binding.key)) ??
      emptyConversationState(binding.key, "companion-exclusive", updatedAt);

    const nextState: ConversationCompanionState = {
      ...state,
      mode: "companion-exclusive",
      updatedAt,
    };
    await this.dependencies.conversationStates.save(nextState);
    await this.log({
      tripId: binding.lastTripId ?? `conversation:${binding.key}`,
      runId,
      phase: "system",
      event: "conversation.activated",
      decision: "Activated companion-exclusive takeover for this conversation.",
      provider: "conversation-service",
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        conversationKey: binding.key,
        mode: nextState.mode,
      },
    });
    return nextState;
  }

  async deactivateConversation(
    conversationKey: string,
  ): Promise<ConversationCompanionState> {
    const startedAt = nowIso(this.dependencies.clock);
    const runId = randomUUID();
    const updatedAt = nowIso(this.dependencies.clock);
    const state =
      (await this.dependencies.conversationStates.getByKey(conversationKey)) ??
      emptyConversationState(conversationKey, "default", updatedAt);

    const nextState: ConversationCompanionState = {
      ...state,
      mode: "default",
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      updatedAt,
    };
    await this.dependencies.conversationStates.save(nextState);
    this.inFlightConversationKeys.delete(conversationKey);
    await this.log({
      tripId: `conversation:${conversationKey}`,
      runId,
      phase: "system",
      event: "conversation.deactivated",
      decision: "Deactivated companion takeover and cleared pending reply state.",
      provider: "conversation-service",
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        conversationKey,
        mode: nextState.mode,
      },
    });
    return nextState;
  }

  async claimInboundMessage(input: {
    binding: ConversationBindingRecord;
    messageId: string;
    content: string;
    senderId?: string;
    senderName?: string;
    senderUsername?: string;
  }): Promise<ConversationCompanionState> {
    const startedAt = nowIso(this.dependencies.clock);
    const runId = randomUUID();
    await this.log({
      tripId: input.binding.lastTripId ?? `conversation:${input.binding.key}`,
      runId,
      phase: "system",
      event: "inbound.claimed",
      decision: "Claimed inbound user message for companion-exclusive takeover.",
      provider: "conversation-service",
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        conversationKey: input.binding.key,
        messageId: input.messageId,
        mode: input.binding.mode,
      },
    });

    return this.enqueueInboundMessage(input);
  }

  async isInboundCommandDuplicate(input: {
    conversationKey: string;
    messageId?: string;
  }): Promise<boolean> {
    if (!input.messageId) {
      return false;
    }

    const state = await this.dependencies.conversationStates.getByKey(
      input.conversationKey,
    );
    return (
      state?.recentHandledCommandMessageIds?.includes(input.messageId) ?? false
    );
  }

  async rememberHandledInboundCommand(input: {
    conversationKey: string;
    messageId?: string;
  }): Promise<ConversationCompanionState | null> {
    if (!input.messageId) {
      return await this.dependencies.conversationStates.getByKey(
        input.conversationKey,
      );
    }

    const updatedAt = nowIso(this.dependencies.clock);
    const state =
      (await this.dependencies.conversationStates.getByKey(input.conversationKey)) ??
      emptyConversationState(input.conversationKey, "companion-exclusive", updatedAt);

    const nextState: ConversationCompanionState = {
      ...state,
      recentHandledCommandMessageIds: trimRecentMessageIds(
        [
          ...(state.recentHandledCommandMessageIds ?? []).filter(
            (messageId) => messageId !== input.messageId,
          ),
          input.messageId,
        ],
        20,
      ),
      updatedAt,
    };
    await this.dependencies.conversationStates.save(nextState);
    return nextState;
  }

  async enqueueInboundMessage(input: {
    binding: ConversationBindingRecord;
    messageId: string;
    content: string;
    senderId?: string;
    senderName?: string;
    senderUsername?: string;
  }): Promise<ConversationCompanionState> {
    const startedAt = nowIso(this.dependencies.clock);
    const activeTrip = await this.getActiveTrip(input.binding);
    const updatedAt = nowIso(this.dependencies.clock);
    const state =
      (await this.dependencies.conversationStates.getByKey(input.binding.key)) ??
      emptyConversationState(input.binding.key, input.binding.mode, updatedAt);

    const replySchedule = deriveReplyDueAt({
      conversationKey: input.binding.key,
      messageId: input.messageId,
      now: this.dependencies.clock.now(),
      activeTrip,
      conversationState: state,
    });
    const businessSituation = replySchedule.businessSituation;
    const dueAt = replySchedule.dueAt;
    const pendingUserMessages = [
      ...state.pendingUserMessages,
      {
        messageId: input.messageId,
        content: input.content,
        receivedAt: updatedAt,
        senderId: input.senderId,
        senderName: input.senderName,
        senderUsername: input.senderUsername,
      },
    ];

    const nextState: ConversationCompanionState = {
      ...state,
      mode: input.binding.mode,
      pendingUserMessages,
      pendingReplyDispatch: {
        conversationKey: input.binding.key,
        dedupeKey: `${input.binding.key}:${input.messageId}`,
        dueAt,
        segments: [],
        sourceMessageIds: pendingUserMessages.map((message) => message.messageId),
        instantSeen: replySchedule.instantSeen,
      },
      instantReplyWindow: replySchedule.instantReplyWindow,
      recentTurns: trimTurns(
        [
          ...state.recentTurns,
          {
            role: "user",
            text: input.content,
            createdAt: updatedAt,
            tripId: activeTrip?.tripId,
          },
        ],
        12,
      ),
      lastUserMessageAt: updatedAt,
      updatedAt,
    };
    await this.dependencies.conversationStates.save(nextState);

    await this.log({
      tripId: activeTrip?.tripId ?? `conversation:${input.binding.key}`,
      runId: randomUUID(),
      phase: activeTrip?.state.currentPhase ?? "system",
      event: "inbound.enqueued",
      decision: "Queued inbound user message for delayed companion reply.",
      provider: "conversation-service",
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        conversationKey: input.binding.key,
        messageId: input.messageId,
        queuedMessageCount: pendingUserMessages.length,
        replyDueAt: dueAt,
        mode: input.binding.mode,
        businessMode: businessSituation.mode,
        businessState: businessSituation.state,
        businessSubstate: businessSituation.substate,
        businessScene: businessSituation.scene,
        businessPresence: businessSituation.presence,
        instantSeen: replySchedule.instantSeen,
      },
    });

    await this.log({
      tripId: activeTrip?.tripId ?? `conversation:${input.binding.key}`,
      runId: randomUUID(),
      phase: activeTrip?.state.currentPhase ?? "system",
      event: "reply.deferred",
      decision: "Deferred reply until the scheduled due time.",
      provider: "conversation-service",
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        conversationKey: input.binding.key,
        messageId: input.messageId,
        replyDueAt: dueAt,
        mode: input.binding.mode,
        businessMode: businessSituation.mode,
        businessState: businessSituation.state,
        businessSubstate: businessSituation.substate,
        businessScene: businessSituation.scene,
        businessPresence: businessSituation.presence,
        instantSeen: replySchedule.instantSeen,
      },
    });

    return nextState;
  }

  async runDueConversations(): Promise<ConversationCompanionState[]> {
    const dueStates = await this.dependencies.conversationStates.listDueConversations(
      this.dependencies.clock.now(),
    );

    const results: ConversationCompanionState[] = [];
    for (const state of dueStates) {
      results.push(await this.runConversation(state.conversationKey));
    }
    return results;
  }

  async runConversation(
    conversationKey: string,
    options?: { ignoreSchedule?: boolean },
  ): Promise<ConversationCompanionState> {
    if (this.inFlightConversationKeys.has(conversationKey)) {
      return await this.requireConversationState(conversationKey);
    }

    this.inFlightConversationKeys.add(conversationKey);
    const startedAt = nowIso(this.dependencies.clock);
    const runId = randomUUID();

    try {
      const binding = await this.dependencies.bindings.get(conversationKey);
      if (!binding) {
        throw new Error(`Conversation binding not found: ${conversationKey}`);
      }

      const state = await this.requireConversationState(conversationKey);
      if (binding.mode !== "companion-exclusive" || state.mode !== "companion-exclusive") {
        return state;
      }

      if (!state.pendingReplyDispatch) {
        return state;
      }

      if (
        !options?.ignoreSchedule &&
        new Date(state.pendingReplyDispatch.dueAt).getTime() >
          this.dependencies.clock.now().getTime()
      ) {
        await this.log({
          tripId: binding.lastTripId ?? `conversation:${conversationKey}`,
          runId,
          phase: "system",
          event: "reply.skipped",
          decision: "Reply is not due yet.",
          provider: "conversation-service",
          status: "skipped",
          startedAt,
          finishedAt: nowIso(this.dependencies.clock),
          details: {
            conversationKey,
            replyDueAt: state.pendingReplyDispatch.dueAt,
            mode: binding.mode,
          },
        });
        return state;
      }

      if (state.pendingReplyDispatch.segments.length === 0) {
        return await this.generateAndDispatch(binding, state, runId, startedAt);
      }

      return await this.dispatchPending(binding, state, runId, startedAt);
    } catch (error) {
      await this.log({
        tripId: `conversation:${conversationKey}`,
        runId,
        phase: "system",
        event: "reply.send_failed",
        decision: "Conversation reply run failed.",
        provider: "conversation-service",
        status: "failure",
        startedAt,
        finishedAt: nowIso(this.dependencies.clock),
        errorCode: error instanceof Error ? error.name : "UnknownError",
        details: {
          conversationKey,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      this.inFlightConversationKeys.delete(conversationKey);
    }
  }

  async inspectConversation(input: {
    binding: ConversationBindingRecord;
  }): Promise<{
    state: ConversationCompanionState | null;
    activeTrip: TripRecord | null;
    businessSituation: CompanionBusinessSituation;
  }> {
    const state = await this.dependencies.conversationStates.getByKey(
      input.binding.key,
    );
    const activeTrip = await this.getActiveTrip(input.binding);
    const businessSituation = deriveCompanionBusinessSituation(
      activeTrip,
      this.dependencies.clock.now(),
    );

    return {
      state,
      activeTrip,
      businessSituation,
    };
  }

  private async generateAndDispatch(
    binding: ConversationBindingRecord,
    state: ConversationCompanionState,
    runId: string,
    startedAt: string,
  ): Promise<ConversationCompanionState> {
    const activeTrip = await this.getActiveTrip(binding);
    const businessSituation = deriveCompanionBusinessSituation(
      activeTrip,
      this.dependencies.clock.now(),
    );
    const persona = await this.getPersona(binding);
    await this.log({
      tripId: activeTrip?.tripId ?? `conversation:${binding.key}`,
      runId,
      phase: activeTrip?.state.currentPhase ?? "system",
      event: "reply.batch_built",
      decision: "Prepared a batched delayed reply from queued user messages.",
      provider: "conversation-service",
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        conversationKey: binding.key,
        queuedMessageCount: state.pendingUserMessages.length,
        businessMode: businessSituation.mode,
        businessState: businessSituation.state,
        businessSubstate: businessSituation.substate,
        businessScene: businessSituation.scene,
        businessPresence: businessSituation.presence,
      },
    });

    const replyPlan =
      persona === null
        ? {
            segments: [
              "我还没准备好出发呢，先用 /travel-companion setup 帮我设定形象和性格吧，然后我就能认真回你了。",
            ],
            provider: "conversation-service",
          }
        : await this.dependencies.grounding.composeCompanionReply({
            conversationKey: binding.key,
            persona,
            pendingUserMessages: state.pendingUserMessages,
            recentTurns: filterReplyTurnsForActiveTrip(
              state.recentTurns,
              activeTrip,
            ),
            activeTrip,
            businessSituation,
            now: nowIso(this.dependencies.clock),
          });

    const pendingReplyDispatch = {
      ...state.pendingReplyDispatch!,
      segments: replyPlan.segments,
    };

    const updatedState: ConversationCompanionState = {
      ...state,
      pendingReplyDispatch,
      updatedAt: nowIso(this.dependencies.clock),
    };
    await this.dependencies.conversationStates.save(updatedState);

    await this.log({
      tripId: activeTrip?.tripId ?? `conversation:${binding.key}`,
      runId,
      phase: activeTrip?.state.currentPhase ?? "system",
      event: "reply.generated",
      decision: "Generated delayed companion reply segments.",
      provider: replyPlan.provider,
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        conversationKey: binding.key,
        queuedMessageCount: state.pendingUserMessages.length,
        segmentCount: replyPlan.segments.length,
        replyDueAt: pendingReplyDispatch.dueAt,
        businessMode: businessSituation.mode,
        businessState: businessSituation.state,
        businessSubstate: businessSituation.substate,
        businessScene: businessSituation.scene,
        businessPresence: businessSituation.presence,
      },
    });

    await this.log({
      tripId: activeTrip?.tripId ?? `conversation:${binding.key}`,
      runId,
      phase: activeTrip?.state.currentPhase ?? "system",
      event: "reply.pending",
      decision: "Persisted pending reply before delivery.",
      provider: replyPlan.provider,
      status: "success",
      startedAt,
      finishedAt: nowIso(this.dependencies.clock),
      details: {
        conversationKey: binding.key,
        queuedMessageCount: state.pendingUserMessages.length,
        businessMode: businessSituation.mode,
        businessScene: businessSituation.scene,
        businessPresence: businessSituation.presence,
      },
    });

    return this.dispatchPending(binding, updatedState, runId, startedAt);
  }

  private async dispatchPending(
    binding: ConversationBindingRecord,
    state: ConversationCompanionState,
    runId: string,
    startedAt: string,
  ): Promise<ConversationCompanionState> {
    const pending = state.pendingReplyDispatch;
    if (!pending) {
      return state;
    }

    const activeTrip = await this.getActiveTrip(binding);
    const businessSituation = deriveCompanionBusinessSituation(
      activeTrip,
      this.dependencies.clock.now(),
    );
    const sentAt = nowIso(this.dependencies.clock);
    for (const [index, segment] of pending.segments.entries()) {
      await this.dependencies.messenger.sendTextReply({
        binding,
        text: segment,
        dedupeKey: `${pending.dedupeKey}:${index}`,
      });
    }

    const updatedState: ConversationCompanionState = {
      ...state,
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: createReplyHotWindow({
        conversationKey: binding.key,
        businessSituation,
        triggerAt: sentAt,
        source: "reply",
      }),
      recentTurns: trimTurns(
        [
          ...state.recentTurns,
          {
            role: "companion",
            text: pending.segments.join("\n"),
            createdAt: sentAt,
            tripId: activeTrip?.tripId,
          },
        ],
        12,
      ),
      lastCompanionReplyAt: sentAt,
      updatedAt: sentAt,
    };
    await this.dependencies.conversationStates.save(updatedState);

    await this.log({
      tripId: activeTrip?.tripId ?? `conversation:${binding.key}`,
      runId,
      phase: activeTrip?.state.currentPhase ?? "system",
      event: "reply.sent",
      decision: "Delivered delayed companion reply.",
      provider: "conversation-service",
      status: "success",
      startedAt,
      finishedAt: sentAt,
      details: {
        conversationKey: binding.key,
        segmentCount: pending.segments.length,
        queuedMessageCount: pending.sourceMessageIds.length,
        businessMode: businessSituation.mode,
        businessState: businessSituation.state,
        businessSubstate: businessSituation.substate,
        businessScene: businessSituation.scene,
        businessPresence: businessSituation.presence,
      },
    });

    return updatedState;
  }

  private async getActiveTrip(
    binding: ConversationBindingRecord,
  ): Promise<TripRecord | null> {
    if (!binding.lastTripId) {
      return null;
    }
    const trip = await this.dependencies.tripRepository.getById(binding.lastTripId);
    if (!trip || trip.state.status === "completed") {
      return null;
    }
    return trip;
  }

  private async getPersona(
    binding: ConversationBindingRecord,
  ): Promise<StoredPersonaProfile | null> {
    if (!binding.defaultPersonaId) {
      return null;
    }
    return await this.dependencies.personaRepository.getById(binding.defaultPersonaId);
  }

  private async requireConversationState(
    conversationKey: string,
  ): Promise<ConversationCompanionState> {
    const state = await this.dependencies.conversationStates.getByKey(conversationKey);
    if (!state) {
      throw new Error(`Conversation state not found: ${conversationKey}`);
    }
    return state;
  }

  private async log(input: Omit<LogEntry, "latencyMs">): Promise<void> {
    const entry: LogEntry = {
      ...input,
      latencyMs: elapsedMs(input.startedAt, input.finishedAt),
    };
    await this.dependencies.logger.log(entry);
  }
}
