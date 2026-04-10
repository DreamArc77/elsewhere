import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ConversationBindingRecord, ConversationBindingStore } from "../domain/types.js";

interface BindingRegistry {
  conversations: Record<string, ConversationBindingRecord>;
}

const emptyRegistry = (): BindingRegistry => ({ conversations: {} });

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tempPath, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export class BindingRegistryStore implements ConversationBindingStore {
  private readonly filePath: string;

  constructor(rootDir: string) {
    this.filePath = join(rootDir, "bindings", "conversation-bindings.json");
  }

  async get(key: string): Promise<ConversationBindingRecord | null> {
    const registry = (await readJson<BindingRegistry>(this.filePath)) ?? emptyRegistry();
    return registry.conversations[key] ?? null;
  }

  async list(): Promise<ConversationBindingRecord[]> {
    const registry = (await readJson<BindingRegistry>(this.filePath)) ?? emptyRegistry();
    return Object.values(registry.conversations);
  }

  async upsert(record: ConversationBindingRecord): Promise<void> {
    const registry = (await readJson<BindingRegistry>(this.filePath)) ?? emptyRegistry();
    registry.conversations[record.key] = record;
    await atomicWriteJson(this.filePath, registry);
  }
}

export function bindingKey(input: {
  channel: string;
  accountId?: string;
  target: string;
  threadId?: string | number;
}): string {
  return [
    input.channel,
    input.accountId ?? "default",
    input.target,
    input.threadId ?? "main",
  ].join("::");
}
