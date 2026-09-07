import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  {
    ignores: [
      ".svelte-kit/**",
      ".wrangler/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "package/**",
      "playwright-report/**",
      "supabase/.branches/**",
      "supabase/.temp/**",
      "test-results/**",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  ...svelte.configs["flat/prettier"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
    rules: {
      "svelte/no-navigation-without-resolve": "off",
      "svelte/no-unused-svelte-ignore": "off",
      "svelte/require-each-key": "off",
    },
  },
  {
    files: [
      "src/lib/domain/**/*.ts",
      "src/lib/engine/**/*.ts",
      "src/lib/questionnaire/**/*.ts",
      "src/lib/reviews/**/*.ts",
      "src/lib/workouts/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["$app/*", "$env/*", "@supabase/*", "$lib/server/*"],
              message:
                "Domain and contract modules must remain deterministic and independent of SvelteKit, secrets, Supabase, and server I/O.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.svelte"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "$env/static/private",
                "$env/dynamic/private",
                "$lib/server/*",
              ],
              message:
                "Client-rendered components cannot import secrets or server-only modules.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
