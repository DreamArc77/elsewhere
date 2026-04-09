import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { LogEntry, LoggerPort } from "../domain/types.js";

export class JsonlFileLogger implements LoggerPort {
  constructor(private readonly logsDir: string) {}

  async log(entry: LogEntry): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
    const fileName = `${entry.startedAt.slice(0, 10)}.jsonl`;
    const path = join(this.logsDir, fileName);
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
