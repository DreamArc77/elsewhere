import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
};

const IMAGE_EXTENSION_PATTERN = /\.(png|webp|jpe?g)$/i;
const HTTP_URL_PATTERN = /https?:\/\/\S+/giu;

function sanitizeUrlCandidate(value: string): string {
  return value.trim().replace(/[)>.,!?]+$/u, "");
}

function inferExtensionFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const extension = extname(parsed.pathname).toLowerCase();
    return IMAGE_EXTENSION_PATTERN.test(extension) ? extension : null;
  } catch {
    return null;
  }
}

function inferExtensionFromMimeType(mimeType: string | null): string | null {
  if (!mimeType) {
    return null;
  }

  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  return normalized ? (IMAGE_MIME_TO_EXTENSION[normalized] ?? null) : null;
}

export function extractReferenceImageInput(
  explicitOption: string | undefined,
  commandBody: string,
): string | null {
  if (explicitOption?.trim()) {
    return explicitOption.trim();
  }

  const candidates = commandBody.match(HTTP_URL_PATTERN) ?? [];
  for (const candidate of candidates) {
    const cleaned = sanitizeUrlCandidate(candidate);
    if (inferExtensionFromUrl(cleaned)) {
      return cleaned;
    }
  }

  return candidates.length > 0 ? sanitizeUrlCandidate(candidates[0]!) : null;
}

export function isRemoteImageReference(value: string): boolean {
  return /^https?:\/\//iu.test(value.trim());
}

export async function materializeReferenceImage(input: {
  source: string;
  personasDir: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const source = input.source.trim();
  if (!isRemoteImageReference(source)) {
    return source;
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(source);
  if (!response.ok) {
    throw new Error(`Failed to download reference image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  const extension =
    inferExtensionFromMimeType(contentType) ??
    inferExtensionFromUrl(source) ??
    ".bin";

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.length === 0) {
    throw new Error("Reference image download returned an empty file.");
  }

  const assetsDir = join(input.personasDir, "reference-assets");
  await mkdir(assetsDir, { recursive: true });
  const safeBaseName = basename(new URL(source).pathname || "reference").replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
  const fileName = `${randomUUID()}-${safeBaseName || "reference"}${safeBaseName.endsWith(extension) ? "" : extension}`;
  const finalPath = join(assetsDir, fileName);
  const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, bytes);
  await rename(tempPath, finalPath);
  return finalPath;
}
