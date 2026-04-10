import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { OpenClawTravelCompanionService } from "../../src/application/openclaw-travel-companion-service.js";
import { CompanionConversationService } from "../../src/application/companion-conversation-service.js";
import { RuntimeHooks } from "../../src/domain/types.js";
import {
  JsonArtifactStore,
  JsonConversationStateRepository,
  JsonPersonaRepository,
  JsonTripRepository,
  ensureRuntimeDataPaths,
} from "../../src/infrastructure/json-file-repositories.js";
import { JsonlFileLogger } from "../../src/infrastructure/jsonl-file-logger.js";
import { BindingRegistryStore } from "../../src/openclaw-plugin/binding-state.js";
import {
  FakeClock,
  FakeGroundingPort,
  FakeImageGenerationPort,
  FakeMessenger,
  FakeScheduler,
} from "../../src/testing/fakes.js";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9mA0QAAAAASUVORK5CYII=";

export async function createTestRuntime(options?: {
  days?: number;
  now?: Date;
  hooks?: RuntimeHooks;
}) {
  const rootDir = await mkdtemp(join(tmpdir(), "openclaw-travel-"));
  const paths = await ensureRuntimeDataPaths(rootDir);
  const referenceImagePath = join(rootDir, "persona-reference.png");
  await writeFile(referenceImagePath, Buffer.from(tinyPngBase64, "base64"));

  const clock = new FakeClock(options?.now ?? new Date("2026-04-09T00:00:00.000Z"));
  const scheduler = new FakeScheduler();
  const messenger = new FakeMessenger();
  const grounding = new FakeGroundingPort(options?.days ?? 3);
  const imageGeneration = new FakeImageGenerationPort();
  const logger = new JsonlFileLogger(paths.logsDir);
  const personaRepository = new JsonPersonaRepository(paths.personasDir);
  const tripRepository = new JsonTripRepository(paths.tripsDir);
  const conversationStateRepository = new JsonConversationStateRepository(
    paths.conversationsDir,
  );
  const artifactStore = new JsonArtifactStore(paths.artifactsDir);
  const bindings = new BindingRegistryStore(rootDir);
  const service = new OpenClawTravelCompanionService({
    personaRepository,
    tripRepository,
    artifactStore,
    scheduler,
    messenger,
    grounding,
    imageGeneration,
    clock,
    logger,
    hooks: options?.hooks,
  });
  const conversationService = new CompanionConversationService({
    bindings,
    conversationStates: conversationStateRepository,
    tripRepository,
    personaRepository,
    grounding,
    messenger,
    clock,
    logger,
  });

  return {
    rootDir,
    paths,
    referenceImagePath,
    clock,
    scheduler,
    messenger,
    grounding,
    imageGeneration,
    logger,
    bindings,
    personaRepository,
    tripRepository,
    conversationStateRepository,
    artifactStore,
    service,
    conversationService,
  };
}
