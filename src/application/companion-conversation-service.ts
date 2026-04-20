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
  resolveAgentState,
} from "../domain/business-situation.js";
import { getSystemCatalog, getSystemLocale } from "../openclaw-plugin/i18n/catalog.js";
import { buildIdleGuideMessage } from "../openclaw-plugin/onboarding.js";

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

const IDLE_GUIDE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function emptyConversationState(
  conversationKey: string,
  mode: ConversationBindingRecord["mode"],
  updatedAt: string,
): ConversationCompanionState {
  return {
    conversationKey,
    mode,
    systemLocale: undefined,
    setupSession: undefined,
    pendingUserMessages: [],
    pendingReplyDispatch: null,
    instantReplyWindow: null,
    recentHandledCommandMessageIds: [],
    recentTurns: [],
    latestPostcardPhoto: undefined,
    idleEnteredAt: null,
    idleGuideSentAt: null,
    awaitingDestination: false,
    pendingDestinationCandidate: null,
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
      idleDestinationStarter?: (input: {
        binding: ConversationBindingRecord;
        destination: string;
      }) => Promise<TripRecord>;
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
      systemLocale: state.systemLocale,
      setupSession: undefined,
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      latestPostcardPhoto: undefined,
      idleEnteredAt: null,
      idleGuideSentAt: null,
      awaitingDestination: false,
      pendingDestinationCandidate: null,
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

  async clearRuntimeState(input: {
    conversationKey: string;
    preserveMode?: ConversationCompanionState["mode"];
  }): Promise<ConversationCompanionState> {
    const updatedAt = nowIso(this.dependencies.clock);
    const state =
      (await this.dependencies.conversationStates.getByKey(input.conversationKey)) ??
      emptyConversationState(
        input.conversationKey,
        input.preserveMode ?? "companion-exclusive",
        updatedAt,
      );

    const nextState: ConversationCompanionState = {
      ...state,
      mode: input.preserveMode ?? state.mode,
      systemLocale: state.systemLocale,
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      latestPostcardPhoto: undefined,
      idleEnteredAt: null,
      idleGuideSentAt: null,
      awaitingDestination: false,
      pendingDestinationCandidate: null,
      updatedAt,
    };
    await this.dependencies.conversationStates.save(nextState);
    this.inFlightConversationKeys.delete(input.conversationKey);
    return nextState;
  }

  async getConversationState(
    conversationKey: string,
  ): Promise<ConversationCompanionState | null> {
    return await this.dependencies.conversationStates.getByKey(conversationKey);
  }

  async saveConversationState(
    state: ConversationCompanionState,
  ): Promise<void> {
    await this.dependencies.conversationStates.save(state);
  }

  async enterIdleAwaitingDestination(input: {
    binding: ConversationBindingRecord;
    sendGuideNow: boolean;
    clearConversationContext?: boolean;
    reason:
      | "activate"
      | "first_onboarding_complete"
      | "trip_stopped"
      | "trip_completed";
  }): Promise<ConversationCompanionState> {
    const updatedAt = nowIso(this.dependencies.clock);
    const state =
      (await this.dependencies.conversationStates.getByKey(input.binding.key)) ??
      emptyConversationState(input.binding.key, input.binding.mode, updatedAt);

    const nextState: ConversationCompanionState = {
      ...state,
      mode: input.binding.mode,
      systemLocale: state.systemLocale,
      setupSession: undefined,
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      recentTurns: input.clearConversationContext ? [] : state.recentTurns,
      latestPostcardPhoto: undefined,
      idleEnteredAt: updatedAt,
      idleGuideSentAt: null,
      awaitingDestination: true,
      pendingDestinationCandidate: null,
      lastUserMessageAt: input.clearConversationContext
        ? null
        : state.lastUserMessageAt,
      lastCompanionReplyAt: input.clearConversationContext
        ? null
        : state.lastCompanionReplyAt,
      updatedAt,
    };
    await this.dependencies.conversationStates.save(nextState);

    await this.log({
      tripId: input.binding.lastTripId ?? `conversation:${input.binding.key}`,
      runId: randomUUID(),
      phase: "system",
      event: "idle.entered",
      decision: "Entered idle destination loop and armed semantic destination detection.",
      provider: "conversation-service",
      status: "success",
      startedAt: updatedAt,
      finishedAt: updatedAt,
      details: {
        conversationKey: input.binding.key,
        reason: input.reason,
        sendGuideNow: input.sendGuideNow,
        clearConversationContext: Boolean(input.clearConversationContext),
      },
    });

    if (!input.sendGuideNow) {
      return nextState;
    }

    return await this.sendIdleGuide(input.binding, nextState, input.reason);
  }

  async runDueIdleGuides(): Promise<ConversationCompanionState[]> {
    const bindings = await this.dependencies.bindings.list();
    const dueStates: ConversationCompanionState[] = [];

    for (const binding of bindings) {
      if (binding.mode !== "companion-exclusive") {
        continue;
      }

      const activeTrip = await this.getActiveTrip(binding);
      if (activeTrip) {
        continue;
      }

      const state = await this.dependencies.conversationStates.getByKey(binding.key);
      if (!state?.awaitingDestination || state.idleGuideSentAt) {
        continue;
      }

      const idleEnteredAt = state.idleEnteredAt
        ? new Date(state.idleEnteredAt).getTime()
        : NaN;
      if (
        Number.isNaN(idleEnteredAt) ||
        idleEnteredAt + IDLE_GUIDE_COOLDOWN_MS >
          this.dependencies.clock.now().getTime()
      ) {
        continue;
      }

      dueStates.push(await this.sendIdleGuide(binding, state, "trip_completed"));
    }

    return dueStates;
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
    resolvedState: ReturnType<typeof resolveAgentState>;
  }> {
    const state = await this.dependencies.conversationStates.getByKey(
      input.binding.key,
    );
    const activeTrip = await this.getActiveTrip(input.binding);
    const resolvedState = resolveAgentState({
      activeTrip,
      conversationState: state,
      now: this.dependencies.clock.now(),
    });
    const businessSituation = resolvedState
      ? deriveCompanionBusinessSituation(activeTrip, this.dependencies.clock.now())
      : deriveCompanionBusinessSituation(activeTrip, this.dependencies.clock.now());

    return {
      state,
      activeTrip,
      businessSituation,
      resolvedState,
    };
  }

  private async generateAndDispatch(
    binding: ConversationBindingRecord,
    state: ConversationCompanionState,
    runId: string,
    startedAt: string,
  ): Promise<ConversationCompanionState> {
    const activeTrip = await this.getActiveTrip(binding);
    const resolvedState = resolveAgentState({
      activeTrip,
      conversationState: state,
      now: this.dependencies.clock.now(),
    });
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
              getSystemCatalog(getSystemLocale(state)).replyErrors.personaRequired,
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
            latestPostcardPhoto:
              state.latestPostcardPhoto?.tripId === activeTrip?.tripId
                ? state.latestPostcardPhoto
                : undefined,
            activeTrip,
            resolvedState,
            destinationLoopContext: {
              awaitingDestination: Boolean(state.awaitingDestination),
              idleEnteredAt: state.idleEnteredAt ?? null,
              idleGuideSentAt: state.idleGuideSentAt ?? null,
              pendingDestinationCandidate:
                state.pendingDestinationCandidate ?? null,
            },
            now: nowIso(this.dependencies.clock),
          });

    const postProcessedState = await this.applyDestinationIntent({
      binding,
      state,
      replyPlan,
      persona,
      runId,
      activeTrip,
    });

    const pendingReplyDispatch = {
      ...state.pendingReplyDispatch!,
      segments: replyPlan.segments,
    };

    const updatedState: ConversationCompanionState = {
      ...postProcessedState,
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
    const resolvedState = resolveAgentState({
      activeTrip,
      conversationState: state,
      now: this.dependencies.clock.now(),
    });
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
        resolvedState,
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

  private async applyDestinationIntent(input: {
    binding: ConversationBindingRecord;
    state: ConversationCompanionState;
    replyPlan: CompanionReplyPlan;
    persona: StoredPersonaProfile | null;
    runId: string;
    activeTrip: TripRecord | null;
  }): Promise<ConversationCompanionState> {
    const intent = input.replyPlan.destinationIntent;
    if (!input.state.awaitingDestination || !intent) {
      return input.state;
    }

    if (intent.outcome === "none") {
      return input.state;
    }

    const baseState: ConversationCompanionState = {
      ...input.state,
      pendingDestinationCandidate:
        intent.outcome === "confirm_candidate"
          ? intent.destination ?? input.state.pendingDestinationCandidate ?? null
          : intent.outcome === "reject_candidate"
            ? null
            : input.state.pendingDestinationCandidate ?? null,
    };

    if (intent.outcome === "confirm_candidate") {
      await this.log({
        tripId: input.activeTrip?.tripId ?? `conversation:${input.binding.key}`,
        runId: input.runId,
        phase: input.activeTrip?.state.currentPhase ?? "system",
        event: "idle.destination.candidate",
        decision: "Stored a pending destination candidate and waited for user confirmation.",
        provider: input.replyPlan.provider,
        status: "success",
        startedAt: nowIso(this.dependencies.clock),
        finishedAt: nowIso(this.dependencies.clock),
        details: {
          conversationKey: input.binding.key,
          destination: intent.destination ?? null,
          confidence: intent.confidence ?? null,
        },
      });
      return baseState;
    }

    if (intent.outcome === "reject_candidate") {
      await this.log({
        tripId: input.activeTrip?.tripId ?? `conversation:${input.binding.key}`,
        runId: input.runId,
        phase: input.activeTrip?.state.currentPhase ?? "system",
        event: "idle.destination.rejected",
        decision: "Cleared the pending destination candidate after the user rejected it.",
        provider: input.replyPlan.provider,
        status: "success",
        startedAt: nowIso(this.dependencies.clock),
        finishedAt: nowIso(this.dependencies.clock),
        details: {
          conversationKey: input.binding.key,
        },
      });
      return baseState;
    }

    const destination = intent.destination?.trim();
    if (!destination || !this.dependencies.idleDestinationStarter) {
      return baseState;
    }

    try {
      const trip = await this.dependencies.idleDestinationStarter({
        binding: input.binding,
        destination,
      });
      await this.log({
        tripId: trip.tripId,
        runId: input.runId,
        phase: "planning",
        event: "idle.destination.trip_started",
        decision: "Started a new trip from the idle destination loop.",
        provider: input.replyPlan.provider,
        status: "success",
        startedAt: nowIso(this.dependencies.clock),
        finishedAt: nowIso(this.dependencies.clock),
        details: {
          conversationKey: input.binding.key,
          destination,
          confidence: intent.confidence ?? null,
        },
      });
      return {
        ...baseState,
        idleEnteredAt: null,
        idleGuideSentAt: null,
        awaitingDestination: false,
        pendingDestinationCandidate: null,
      };
    } catch (error) {
      input.replyPlan.segments = [
        ...input.replyPlan.segments,
        getSystemCatalog(getSystemLocale(input.state)).replyErrors
          .idleDestinationStartFailed,
      ];
      await this.log({
        tripId: `conversation:${input.binding.key}`,
        runId: input.runId,
        phase: "system",
        event: "idle.destination.trip_start_failed",
        decision: "Failed to start a new trip from the idle destination loop.",
        provider: input.replyPlan.provider,
        status: "failure",
        startedAt: nowIso(this.dependencies.clock),
        finishedAt: nowIso(this.dependencies.clock),
        errorCode: error instanceof Error ? error.name : "idle_destination_trip_start_failed",
        details: {
          conversationKey: input.binding.key,
          destination,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return {
        ...baseState,
        pendingDestinationCandidate: destination,
      };
    }
  }

  private async sendIdleGuide(
    binding: ConversationBindingRecord,
    state: ConversationCompanionState,
    reason: "activate" | "first_onboarding_complete" | "trip_stopped" | "trip_completed",
  ): Promise<ConversationCompanionState> {
    const persona = await this.getPersona(binding);
    if (!persona) {
      return state;
    }

    const resolvedState = resolveAgentState({
      activeTrip: null,
      conversationState: state,
      now: this.dependencies.clock.now(),
    });
    const locale = getSystemLocale(state);
    const guide =
      reason === "first_onboarding_complete"
        ? {
            segments: [buildIdleGuideMessage(persona, locale)],
            provider: "system",
          }
        : await this.dependencies.grounding.composeIdleDestinationGuide({
            conversationKey: binding.key,
            persona,
            recentTurns: trimTurns(state.recentTurns, 12),
            resolvedState,
            now: nowIso(this.dependencies.clock),
          });

    const sentAt = nowIso(this.dependencies.clock);
    for (const [index, segment] of guide.segments.entries()) {
      await this.dependencies.messenger.sendTextReply({
        binding,
        text: segment,
        dedupeKey: `idle-guide:${binding.key}:${sentAt}:${index}`,
      });
    }

    const nextState: ConversationCompanionState = {
      ...state,
      idleGuideSentAt: sentAt,
      instantReplyWindow: createReplyHotWindow({
        conversationKey: binding.key,
        resolvedState,
        triggerAt: sentAt,
        source: "reply",
      }),
      recentTurns: trimTurns(
        [
          ...state.recentTurns,
          {
            role: "companion",
            text: guide.segments.join("\n"),
            createdAt: sentAt,
          },
        ],
        12,
      ),
      lastCompanionReplyAt: sentAt,
      updatedAt: sentAt,
    };
    await this.dependencies.conversationStates.save(nextState);

    await this.log({
      tripId: `conversation:${binding.key}`,
      runId: randomUUID(),
      phase: "system",
      event: "idle.guide.sent",
      decision: "Sent the idle destination guide message.",
      provider: guide.provider,
      status: "success",
      startedAt: sentAt,
      finishedAt: sentAt,
      details: {
        conversationKey: binding.key,
        reason,
        segmentCount: guide.segments.length,
      },
    });

    return nextState;
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
