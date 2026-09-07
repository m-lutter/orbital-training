import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
      adapter: adapter(),
      csp: {
        mode: "auto",
        directives: {
          "default-src": ["self"],
          "base-uri": ["self"],
          "connect-src": ["self", "https://challenges.cloudflare.com"],
          "font-src": ["self"],
          "form-action": ["self"],
          "frame-ancestors": ["none"],
          "frame-src": ["https://challenges.cloudflare.com"],
          "img-src": ["self", "data:", "blob:"],
          "manifest-src": ["self"],
          "media-src": ["none"],
          "object-src": ["none"],
          "script-src": ["self", "https://challenges.cloudflare.com"],
          "script-src-attr": ["none"],
          "style-src": ["self"],
          "style-src-attr": ["none"],
          "worker-src": ["self", "blob:"],
        },
      },
    }),
  ],
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        extends: "./vite.config.ts",
        test: {
          name: "client",
          browser: {
            enabled: true,
            api: {
              host: "127.0.0.1",
              port: 4174,
              strictPort: true,
            },
            provider: playwright(),
            instances: [{ browser: "chromium", headless: true }],
          },
          include: ["src/**/*.svelte.{test,spec}.{js,ts}"],
          exclude: ["src/lib/server/**"],
        },
      },

      {
        extends: "./vite.config.ts",
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.{test,spec}.{js,ts}"],
          exclude: ["src/**/*.svelte.{test,spec}.{js,ts}"],
        },
      },
    ],
  },
});
