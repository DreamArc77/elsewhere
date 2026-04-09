import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ArtifactStorePort,
  PersonaRepository,
  StoredPersonaProfile,
  TripRecord,
  TripRepository,
} from "../domain/types.js";

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function atomicWriteText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*]/g, "-");
}

async function readJsonFile<T>(path: string): Promise<T | null> {
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

export interface RuntimeDataPaths {
  rootDir: string;
  personasDir: string;
  tripsDir: string;
  artifactsDir: string;
  logsDir: string;
}

export async function ensureRuntimeDataPaths(
  rootDir: string,
): Promise<RuntimeDataPaths> {
  const paths: RuntimeDataPaths = {
    rootDir,
    personasDir: join(rootDir, "personas"),
    tripsDir: join(rootDir, "trips"),
    artifactsDir: join(rootDir, "artifacts"),
    logsDir: join(rootDir, "logs"),
  };

  await Promise.all([
    ensureDir(paths.personasDir),
    ensureDir(paths.tripsDir),
    ensureDir(paths.artifactsDir),
    ensureDir(paths.logsDir),
  ]);

  return paths;
}

export class JsonPersonaRepository implements PersonaRepository {
  constructor(private readonly personasDir: string) {}

  async save(persona: StoredPersonaProfile): Promise<void> {
    const path = join(this.personasDir, `${persona.personaId}.json`);
    await atomicWriteText(path, JSON.stringify(persona, null, 2));
  }

  async getById(personaId: string): Promise<StoredPersonaProfile | null> {
    return readJsonFile<StoredPersonaProfile>(
      join(this.personasDir, `${personaId}.json`),
    );
  }
}

export class JsonTripRepository implements TripRepository {
  constructor(private readonly tripsDir: string) {}

  async save(record: TripRecord): Promise<void> {
    const path = join(this.tripsDir, `${record.tripId}.json`);
    await atomicWriteText(path, JSON.stringify(record, null, 2));
  }

  async getById(tripId: string): Promise<TripRecord | null> {
    return readJsonFile<TripRecord>(join(this.tripsDir, `${tripId}.json`));
  }

  async listDueTrips(now: Date): Promise<TripRecord[]> {
    const entries = await readdir(this.tripsDir, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) =>
          readJsonFile<TripRecord>(join(this.tripsDir, entry.name)),
        ),
    );

    return records
      .filter((record): record is TripRecord => Boolean(record))
      .filter((record) => {
        if (record.state.status === "completed" || !record.state.nextRunAt) {
          return false;
        }

        return new Date(record.state.nextRunAt).getTime() <= now.getTime();
      });
  }
}

export class JsonArtifactStore implements ArtifactStorePort {
  constructor(private readonly artifactsDir: string) {}

  async writeJsonArtifact(input: {
    tripId: string;
    artifactId: string;
    fileName: string;
    value: unknown;
  }): Promise<string> {
    const tripDir = join(this.artifactsDir, input.tripId);
    const path = join(
      tripDir,
      `${input.artifactId}-${sanitizeFileName(input.fileName)}`,
    );
    await atomicWriteText(path, JSON.stringify(input.value, null, 2));
    return path;
  }

  async writeBinaryArtifact(input: {
    tripId: string;
    artifactId: string;
    fileName: string;
    bytesBase64: string;
  }): Promise<string> {
    const tripDir = join(this.artifactsDir, input.tripId);
    await ensureDir(tripDir);
    const path = join(
      tripDir,
      `${input.artifactId}-${sanitizeFileName(input.fileName)}`,
    );
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, Buffer.from(input.bytesBase64, "base64"));
    await rename(tempPath, path);
    return path;
  }
}
