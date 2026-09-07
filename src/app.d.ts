// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./lib/database.types";

declare global {
  interface Env {
    ASSETS: Fetcher;
    CANONICAL_ORIGIN: string;
    FITNESS_TOKEN_ENCRYPTION_KEY?: string;
    GOOGLE_HEALTH_CLIENT_ID?: string;
    GOOGLE_HEALTH_CLIENT_SECRET?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    TURNSTILE_REQUIRED?: string;
    TURNSTILE_SITE_KEY?: string;
  }

  namespace App {
    interface Locals {
      getUser: () => ReturnType<SupabaseClient<Database>["auth"]["getUser"]>;
      supabase: SupabaseClient<Database>;
    }

    interface Platform {
      env: Env;
      ctx: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }
  }
}

export {};
