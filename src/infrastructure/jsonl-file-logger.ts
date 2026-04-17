import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { LogEntry, LoggerPort } from "../domain/types.js";

export class JsonlFileLogger implements LoggerPort {
  constructor(
    private readonly logsDir: string,
    private readonly logMode: "safe" | "debug" = "safe",
  ) {}

  async log(entry: LogEntry): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
    const fileName = `${entry.startedAt.slice(0, 10)}.jsonl`;
    const path = join(this.logsDir, fileName);
    await appendFile(path, `${JSON.stringify(sanitizeLogEntry(entry, this.logMode))}\n`, "utf8");
  }
}

function sanitizeLogEntry(
  entry: LogEntry,
  logMode: "safe" | "debug",
): LogEntry {
  if (logMode === "debug" || !entry.details) {
    return entry;
  }

  const details = { ...entry.details };
  const redactedKeys = [
    "renderedPrompt",
    "responseTextPreviewHead",
    "responseTextPreviewTail",
    "responseTextStartsWith",
    "responseTextEndsWith",
    "rawResponsePreview",
    "rawModelText",
    "rawTextPreview",
    "commandBody",
  ];

  let redacted = false;
  for (const key of redactedKeys) {
    if (key in details) {
      delete details[key];
      redacted = true;
    }
  }

  if (redacted) {
    details.redacted = true;
  }

  return {
    ...entry,
    details,
  };
}
