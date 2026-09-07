import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Node-only tests do not need the browser project's local listener. */
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
    name: "server",
    environment: "node",
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
    expect: { requireAssertions: true },
    include: ["src/**/*.{test,spec}.{js,ts}"],
    exclude: ["src/**/*.svelte.{test,spec}.{js,ts}"],
  },
});
