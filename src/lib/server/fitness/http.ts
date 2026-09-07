import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  readBoundedJson,
  UnsupportedJsonMediaTypeError,
} from "$lib/server/bounded-json";
import { error, isHttpError, json, type RequestEvent } from "@sveltejs/kit";

export async function fitnessJsonErrorBoundary(
  operation: string,
  fallbackMessage: string,
  run: () => Response | Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (caught) {
    if (isHttpError(caught)) throw caught;
    console.error("Unexpected fitness API failure:", {
      operation,
      type: caught instanceof Error ? caught.name : "unknown",
    });
    return json(
      { message: fallbackMessage },
      {
        status: 500,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
}

export function deferFitnessTask(
  event: Pick<RequestEvent, "platform">,
  operation: string,
  task: Promise<unknown>,
): void {
  const guarded = task.catch((caught: unknown) => {
    console.warn("Deferred fitness task failed:", {
      operation,
      type: caught instanceof Error ? caught.name : "unknown",
    });
  });
  const context = event.platform?.ctx;
  if (context !== undefined && typeof context.waitUntil === "function") {
    context.waitUntil(guarded);
    return;
  }

  // Vite and some adapter test/dev runtimes provide Worker environment
  // bindings without an ExecutionContext. The task has already started and is
  // guarded above, so the status response must not fail merely because there
  // is no waitUntil hook to extend the request lifetime.
  void guarded;
}

export type FitnessTaskSettlement<T> =
  { settled: true; value: T } | { settled: false };

export async function settleFitnessTask<T>(
  task: Promise<T>,
  milliseconds: number,
): Promise<FitnessTaskSettlement<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<FitnessTaskSettlement<T>>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), milliseconds);
  });
  try {
    return await Promise.race([
      task.then((value) => ({ settled: true, value }) as const),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function requireFitnessMutationOrigin(event: RequestEvent): void {
  if (event.request.headers.has("authorization")) return;
  if (event.request.headers.get("origin") !== event.url.origin) {
    throw error(403, "This fitness request was not accepted.");
  }
}

export async function readFitnessObject(
  request: Request,
  maximumBytes = 4096,
): Promise<Record<string, unknown>> {
  try {
    const value = await readBoundedJson(request, maximumBytes);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw error(400, "Fitness input must be a JSON object.");
    }
    return value as Record<string, unknown>;
  } catch (caught) {
    if (caught instanceof UnsupportedJsonMediaTypeError) {
      throw error(415, "Fitness input must be JSON.");
    }
    if (caught instanceof JsonBodyTooLargeError) {
      throw error(413, "Fitness input was too large.");
    }
    if (caught instanceof InvalidJsonBodyError) {
      throw error(400, "Fitness input could not be read.");
    }
    throw caught;
  }
}

export function requiredShortString(
  value: unknown,
  label: string,
  maximumLength = 256,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength
  ) {
    throw error(400, `${label} is invalid.`);
  }
  return value;
}
