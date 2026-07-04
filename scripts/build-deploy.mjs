import { spawnSync } from "node:child_process";

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

run(process.execPath, [
  "node_modules/tailwindcss/lib/cli.js",
  "-i",
  "assets/css/main.css",
  "-o",
  "assets/css/generated.css",
  "--minify",
]);
run("hugo", ["--gc", "--minify", ...extraHugoArgs]);
