import { describe, expect, it } from "vitest";

import { bindingKey } from "../src/openclaw-plugin/binding-state.js";
import { runPendingReferencePhotoFallback } from "../src/openclaw-plugin/service.js";
import { createTestRuntime } from "./helpers/runtime.js";

describe("reference photo fallback probe", () => {
  it("waits for the probe window before sending the fallback reminder", async () => {
    const runtime = await createTestRuntime();
    const key = bindingKey({
      channel: "openclaw-weixin",
      accountId: "bot-1",
      target: "wechat-user-2",
    });
    await runtime.bindings.upsert({
      key,
      channel: "openclaw-weixin",
      accountId: "bot-1",
      target: "wechat-user-2",
      boundAt: Date.now(),
      bindingSource: "local",
      mode: "companion-exclusive",
    });
    await runtime.conversationStateRepository.save({
      conversationKey: key,
      mode: "companion-exclusive",
      setupSession: {
        kind: "persona",
        step: "reference_photo",
        awaitingReferencePhoto: true,
        draft: {
          name: "Mori",
          originCity: "Hong Kong",
          traits: ["gentle"],
          toneStyle: "warm",
          relationship: "travel soulmate",
          userAddressing: "baby",
        },
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      pendingReferencePhotoProbe: {
        startedAt: new Date(Date.now() - 20_000).toISOString(),
        deadlineAt: new Date(Date.now() - 5_000).toISOString(),
        noticeSentAt: new Date(Date.now() - 19_000).toISOString(),
        fallbackSentAt: null,
      },
      pendingUserMessages: [],
      pendingReplyDispatch: null,
      instantReplyWindow: null,
      recentHandledCommandMessageIds: [],
      recentTurns: [],
      idleGuideSentAt: null,
      awaitingDestination: false,
      lastUserMessageAt: null,
      lastCompanionReplyAt: null,
      updatedAt: new Date().toISOString(),
    });

    await runPendingReferencePhotoFallback({
      bundle: {
        service: runtime.service,
        conversationService: runtime.conversationService,
        tripRepository: runtime.tripRepository,
        personaRepository: runtime.personaRepository,
        globalConfigRepository: runtime.globalConfigRepository,
        conversationStateRepository: runtime.conversationStateRepository,
        bindings: runtime.bindings,
        messenger: runtime.messenger,
        runtimeDataPaths: runtime.paths,
        pluginConfig: {
          defaultOriginCity: "Hong Kong",
          pollIntervalSeconds: 60,
          openclawBinaryPath: "openclaw",
        },
        logger: runtime.logger,
      },
      stateDir: runtime.rootDir,
    });

    expect(runtime.messenger.sentReplies).toHaveLength(1);
    expect(runtime.messenger.sentReplies[0]?.text).toContain("图片");
    const state = await runtime.conversationStateRepository.getByKey(key);
    expect(state?.pendingReferencePhotoProbe?.fallbackSentAt).toBeTruthy();
  });
});
