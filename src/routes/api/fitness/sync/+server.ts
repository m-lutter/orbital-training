import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  readBoundedJson,
  UnsupportedJsonMediaTypeError,
} from "$lib/server/bounded-json";
import {
  fitnessConfigurationStatus,
  fitnessRuntimeConfig,
} from "$lib/server/fitness/config";
import { requireFitnessUser } from "$lib/server/fitness/repository";
import {
  foregroundFitnessSync,
  validFitnessSyncTrigger,
  validLocalDate,
  validTimeZone,
} from "$lib/server/fitness/sync";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const POST: RequestHandler = async (event) => {
  const origin = event.request.headers.get("origin");
  const usesBearer = event.request.headers.has("authorization");
  if (!usesBearer && origin !== null && origin !== event.url.origin) {
    return json(
      { message: "Cross-origin sync was not accepted." },
      { status: 403 },
    );
  }
  const { user } = await requireFitnessUser(event);

  let body: Record<string, unknown>;
  try {
    body = record(await readBoundedJson(event.request, 2048)) ?? {};
  } catch (caught) {
    if (caught instanceof UnsupportedJsonMediaTypeError) {
      return json({ message: "Sync input must be JSON." }, { status: 415 });
    }
    if (caught instanceof JsonBodyTooLargeError) {
      return json({ message: "Sync input was too large." }, { status: 413 });
    }
    if (!(caught instanceof InvalidJsonBodyError)) throw caught;
    return json({ message: "Sync input could not be read." }, { status: 400 });
  }
  const timeZone = validTimeZone(body.timeZone);
  const localDate = validLocalDate(body.localDate);
  const trigger = validFitnessSyncTrigger(body.trigger ?? "automatic");
  if (
    timeZone === undefined ||
    localDate === undefined ||
    trigger === undefined
  ) {
    return json(
      { message: "A valid local date and time zone are required." },
      { status: 400 },
    );
  }
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: event.url.protocol === "https:",
    maxAge: 3 * 24 * 60 * 60,
  };
  event.cookies.set("orbital-local-date", localDate, cookieOptions);
  event.cookies.set("orbital-time-zone", timeZone, cookieOptions);
  if (!fitnessConfigurationStatus(event).baseConfigured) {
    return json(
      {
        configured: false,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        partial: 0,
        skipped: 0,
        warnings: [],
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const outcome = await foregroundFitnessSync({
    config: fitnessRuntimeConfig(event),
    userId: user.id,
    timeZone,
    localDate,
    trigger,
  });
  return json(
    { configured: true, ...outcome },
    { headers: { "cache-control": "private, no-store" } },
  );
};
