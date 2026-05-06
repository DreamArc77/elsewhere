import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const pluginJson = JSON.parse(
  readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
);
const version = packageJson.version;
const tag = `v${version}`;

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

function read(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

const sourceCommit = read("git", [
  "rev-parse",
  "--verify",
  `refs/tags/${tag}^{commit}`,
]);

const clawhubArgs = [
  "package",
  "publish",
  ".",
  "--family",
  "code-plugin",
  "--name",
  pluginJson.id ?? "elsewhere",
  "--display-name",
  pluginJson.name ?? "elsewhere",
  "--version",
  version,
  "--source-repo",
  "DreamArc77/elsewhere",
  "--source-commit",
  sourceCommit,
  "--source-ref",
  tag,
  "--source-path",
  ".",
];

if (dryRun) {
  console.log(
    `[dry-run] Skipping ${formatCommand(
      "clawhub",
      clawhubArgs,
    )}; current clawhub CLI does not support dry-run.`,
  );
} else {
  run("clawhub", clawhubArgs);
}

run("npm", [
  "publish",
  "--access",
  "public",
  ...(dryRun ? ["--dry-run"] : []),
]);
