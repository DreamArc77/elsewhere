import { createHash } from "node:crypto";

export function stableBucket(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % 100;
}

export function stableRange(seed: string, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  const span = max - min + 1;
  return min + (stableBucket(seed) % span);
}
