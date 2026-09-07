import { defineConfig, devices } from "playwright/test";
import { loadEnv } from "vite";

const fileEnv = loadEnv("development", process.cwd(), "");
const supabaseUrl =
  process.env.PUBLIC_SUPABASE_URL ?? fileEnv.PUBLIC_SUPABASE_URL ?? "";
const localSupabase = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(
  supabaseUrl,
);

if (!localSupabase) {
  throw new Error(
    "Full-stack tests are local-only. Start Supabase and set PUBLIC_SUPABASE_URL in .env.local to http://127.0.0.1:54321.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results/e2e",
  use: {
    baseURL: "http://127.0.0.1:4173",
    ...devices["iPhone 13"],
    browserName: "chromium",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
