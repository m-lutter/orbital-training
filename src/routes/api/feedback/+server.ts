import { APP_VERSION } from "$lib/app-meta";
import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  readBoundedJson,
  UnsupportedJsonMediaTypeError,
} from "$lib/server/bounded-json";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const CATEGORIES = ["bug", "confusing", "idea", "other"] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function browserFamily(userAgent: string): string {
  if (/firefox|fxios/i.test(userAgent)) return "Firefox";
  if (/edg|edgios|edga/i.test(userAgent)) return "Edge";
  if (/chrome|crios|chromium/i.test(userAgent)) return "Chromium";
  if (/safari/i.test(userAgent)) return "Safari";
  return "Other";
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin)
    return json(
      { message: "This feedback request was not accepted." },
      { status: 403 },
    );

  const {
    data: { user },
  } = await locals.getUser();
  if (!user)
    return json(
      { message: "Sign in before sending feedback." },
      { status: 401 },
    );

  let body: Record<string, unknown>;
  try {
    body = record(await readBoundedJson(request, 16_384)) ?? {};
  } catch (error) {
    if (error instanceof UnsupportedJsonMediaTypeError)
      return json(
        { message: "Feedback must be sent as JSON." },
        { status: 415 },
      );
    if (error instanceof JsonBodyTooLargeError)
      return json(
        { message: "The feedback request was too large." },
        { status: 413 },
      );
    if (!(error instanceof InvalidJsonBodyError)) throw error;
    return json(
      { message: "The feedback form could not be read." },
      { status: 400 },
    );
  }

  // A bot that fills the hidden field receives a generic success response so
  // it cannot tune itself against the filter. No row is written.
  if (String(body.website ?? "").trim() !== "")
    return json({ reference: "RECEIVED" });

  const category = String(body.category ?? "");
  const message = String(body.message ?? "").trim();
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number]))
    return json({ message: "Choose a feedback category." }, { status: 400 });
  if (message.length < 20 || message.length > 4000)
    return json(
      { message: "Feedback must contain between 20 and 4,000 characters." },
      { status: 400 },
    );

  const rawPath = String(body.pagePath ?? "/");
  let pagePath = "/";
  try {
    const parsed = new URL(rawPath, url.origin);
    if (parsed.origin === url.origin) pagePath = parsed.pathname.slice(0, 300);
  } catch {
    // Keep the safe root path.
  }
  const rawProgramId = String(body.programId ?? "");
  const programId = UUID_PATTERN.test(rawProgramId) ? rawProgramId : undefined;
  const suppliedContext = record(body.clientContext) ?? {};
  const clientContext = {
    viewportWidth: boundedInteger(suppliedContext.viewportWidth, 200, 10000),
    viewportHeight: boundedInteger(suppliedContext.viewportHeight, 200, 10000),
    standalone: suppliedContext.standalone === true,
    browserFamily: browserFamily(request.headers.get("user-agent") ?? ""),
  };

  const { data, error } = await locals.supabase.rpc("submit_feedback", {
    p_category: category,
    p_message: message,
    p_blocked_user: body.blockedUser === true,
    p_may_contact: body.mayContact === true,
    p_page_path: pagePath,
    p_program_id: programId,
    p_app_version:
      typeof body.appVersion === "string"
        ? body.appVersion.slice(0, 50)
        : APP_VERSION,
    p_client_context: clientContext,
  });

  if (error || typeof data !== "string") {
    const rateLimited =
      error?.message.includes("feedback_rate_limited") === true;
    const setupMissing = ["PGRST202", "42883", "42P01"].includes(
      error?.code ?? "",
    );
    if (!rateLimited)
      console.error("Unable to save feedback:", {
        code: error?.code,
        message: error?.message,
      });
    return json(
      {
        message: rateLimited
          ? "You have sent several reports recently. Please wait before sending another."
          : setupMissing
            ? "Feedback storage is not ready. Apply the newest Supabase migration and try again."
            : "Feedback could not be saved. Please try again.",
      },
      { status: rateLimited ? 429 : setupMissing ? 503 : 500 },
    );
  }

  return json({ reference: `F-${data.slice(0, 8).toUpperCase()}` });
};
