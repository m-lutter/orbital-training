import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const config = fileURLToPath(
  new URL("../vitest.measure.config.ts", import.meta.url),
);
const checkBudgets = process.argv.includes("--check");
const jsonOnly = process.argv.includes("--json");
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--check" && argument !== "--json");

if (unknownArguments.length > 0) {
  console.error(`Unknown arguments: ${unknownArguments.join(", ")}`);
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [runner, "--config", config, "--run"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      MEASURE_BUDGET_CHECK: checkBudgets ? "1" : "0",
      MEASURE_JSON: jsonOnly ? "1" : "0",
    },
  },
);

if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
