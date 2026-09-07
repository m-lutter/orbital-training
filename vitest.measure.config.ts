import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "src/lib",
      ),
    },
  },
  test: {
    name: "measurement",
    environment: "node",
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
    disableConsoleIntercept: true,
    expect: { requireAssertions: true },
    include: ["scripts/measure-engine.spec.ts"],
  },
});
