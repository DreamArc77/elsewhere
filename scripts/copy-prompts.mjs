import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const sourceDir = resolve("prompts");
const targetDir = resolve("dist", "prompts");

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true, force: true });
