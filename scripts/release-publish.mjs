import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const version = packageJson.version;
const tag = `v${version}`;

function run(command) {
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

run(`git rev-parse --verify refs/tags/${tag}`);
run(
  `clawhub package publish DreamArc77/elsewhere@${tag}${dryRun ? " --dry-run" : ""}`,
);
run(
  `npm publish --access public${dryRun ? " --dry-run" : ""}`,
);
