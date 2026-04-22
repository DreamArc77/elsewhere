import { spawnSync } from "node:child_process";

for (const command of ["npm test", "npm run build", "npm pack --dry-run"]) {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
