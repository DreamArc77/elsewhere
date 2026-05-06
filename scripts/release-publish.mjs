import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");

function formatCommand(command, args) {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function run(command, args) {
  console.log(`$ ${formatCommand(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", [
  "publish",
  "--access",
  "public",
  ...(dryRun ? ["--dry-run"] : []),
]);
