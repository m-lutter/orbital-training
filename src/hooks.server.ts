import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "$env/static/public";
import type { Database } from "$lib/database.types";
import { canonicalRedirectUrl } from "$lib/server/canonical-origin";
import { publicEnvironmentError } from "$lib/server/environment";
import { applySecurityHeaders } from "$lib/server/security-headers";
import { createServerClient } from "@supabase/ssr";
import type { Handle } from "@sveltejs/kit";

let configurationErrorLogged = false;

export const handle: Handle = async ({ event, resolve }) => {
  const canonicalUrl = canonicalRedirectUrl(
    event.url,
    event.request.method,
    event.platform?.env?.CANONICAL_ORIGIN,
  );
  if (canonicalUrl !== undefined) {
    const canonicalResponse = new Response(null, {
      status: 308,
      headers: { location: canonicalUrl.toString() },
    });
    applySecurityHeaders(canonicalResponse, event.url);
    return canonicalResponse;
  }

  const configurationError = publicEnvironmentError({
    supabaseUrl: PUBLIC_SUPABASE_URL,
    supabasePublishableKey: PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (configurationError !== undefined) {
    if (!configurationErrorLogged) {
      console.error(
        "Invalid public deployment configuration:",
        configurationError,
      );
      configurationErrorLogged = true;
    }
    const unavailable = new Response(
      "The application is temporarily unavailable.",
      {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
    applySecurityHeaders(unavailable, event.url);
    return unavailable;
  }

  const authResponseHeaders = new Headers();

  event.locals.supabase = createServerClient<Database>(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => event.cookies.getAll(),

        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            event.cookies.set(name, value, {
              ...options,
              path: "/",
            });
          });

          /*
           * Supabase may provide the same cache header more than
           * once during one request. Collect the latest values and
           * apply each header once after SvelteKit resolves.
           */
          Object.entries(headers).forEach(([name, value]) => {
            authResponseHeaders.set(name, value);
          });
        },
      },
    },
  );

  let userResult: ReturnType<typeof event.locals.supabase.auth.getUser> | null =
    null;
  event.locals.getUser = () => {
    userResult ??= event.locals.supabase.auth.getUser();
    return userResult;
  };

  const response = await resolve(event, {
    filterSerializedResponseHeaders(name: string) {
      return name === "content-range" || name === "x-supabase-api-version";
    },
  });

  authResponseHeaders.forEach((value, name) => {
    response.headers.set(name, value);
  });
  applySecurityHeaders(response, event.url);

  return response;
};
