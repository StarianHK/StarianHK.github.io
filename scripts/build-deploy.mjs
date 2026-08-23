import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const extraHugoArgs = process.argv.slice(2);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveHugoInvocation() {
  const hugoCli = path.resolve("node_modules", "hugo-bin", "bin", "cli.js");
  if (existsSync(hugoCli)) {
    return {
      command: process.execPath,
      args: [hugoCli],
    };
  }

  return {
    command: "hugo",
    args: [],
  };
}

run(process.execPath, [
  "node_modules/tailwindcss/lib/cli.js",
  "-i",
  "assets/css/main.css",
  "-o",
  "assets/css/generated.css",
  "--minify",
]);
const hugo = resolveHugoInvocation();
run(hugo.command, [...hugo.args, "--gc", "--minify", ...extraHugoArgs]);
