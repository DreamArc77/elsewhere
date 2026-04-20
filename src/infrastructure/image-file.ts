import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export async function readInlineImageFromFile(path: string): Promise<{
  mimeType: string;
  bytesBase64: string;
}> {
  const imageBytes = await readFile(path);
  return {
    mimeType: mimeTypeFromPath(path),
    bytesBase64: imageBytes.toString("base64"),
  };
}

function mimeTypeFromPath(path: string): string {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
