import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildFeedbackDigestEmail,
  DEFAULT_FEEDBACK_DIGEST_MAX_EMAILS,
  DEFAULT_FEEDBACK_DIGEST_MAX_REPORTS,
  DEFAULT_FEEDBACK_DIGEST_MAX_SOURCE_BYTES,
  DEFAULT_FEEDBACK_RETENTION_DAYS,
  feedbackDigestEmailBytes,
  feedbackDigestIdempotencyKey,
  isFeedbackDigestDeliveryWindow,
  parseFeedbackDigestClaim,
  MAX_FEEDBACK_DIGEST_EMAIL_BYTES,
} from "../_shared/feedback-digest.ts";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function serviceRoleKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  const secretKeys = JSON.parse(
    requiredEnvironment("SUPABASE_SECRET_KEYS"),
  ) as Record<string, string>;
  const key = secretKeys.default?.trim();
  if (!key) throw new Error("Missing the default Supabase secret key.");
  return key;
}

function retentionDays(): number {
  const raw = Deno.env.get("FEEDBACK_RETENTION_DAYS")?.trim();
  if (!raw) return DEFAULT_FEEDBACK_RETENTION_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error("FEEDBACK_RETENTION_DAYS must be between 1 and 3650.");
  return days;
}

function boundedEnvironmentInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return value;
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return {};
  const value = (await request.json()) as unknown;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const cronSecret = requiredEnvironment("FEEDBACK_DIGEST_CRON_SECRET");
    if (request.headers.get("x-feedback-digest-secret") !== cronSecret)
      return jsonResponse({ error: "Unauthorized." }, 401);

    const body = await requestBody(request);
    const now = new Date();
    if (body.force !== true && !isFeedbackDigestDeliveryWindow(now))
      return jsonResponse({
        emailed: false,
        reason: "outside_delivery_window",
      });

    const supabase = createClient(
      requiredEnvironment("SUPABASE_URL"),
      serviceRoleKey(),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const cleanup = async (): Promise<number> => {
      const result = await supabase.rpc("delete_expired_feedback", {
        p_retention_days: retentionDays(),
      });
      if (result.error) throw result.error;
      return typeof result.data === "number" ? result.data : 0;
    };
    const deleted = await cleanup();

    const maxReports = boundedEnvironmentInteger(
      "FEEDBACK_DIGEST_MAX_REPORTS",
      DEFAULT_FEEDBACK_DIGEST_MAX_REPORTS,
      1,
      100,
    );
    const maxSourceBytes = boundedEnvironmentInteger(
      "FEEDBACK_DIGEST_MAX_SOURCE_BYTES",
      DEFAULT_FEEDBACK_DIGEST_MAX_SOURCE_BYTES,
      10_000,
      1_000_000,
    );
    const maxEmails = boundedEnvironmentInteger(
      "FEEDBACK_DIGEST_MAX_EMAILS",
      DEFAULT_FEEDBACK_DIGEST_MAX_EMAILS,
      1,
      10,
    );
    const deliveries: {
      batchId: string;
      providerEmailId: string;
      reportCount: number;
    }[] = [];

    for (let index = 0; index < maxEmails; index += 1) {
      const claimResult = await supabase.rpc("claim_feedback_digest", {
        p_max_reports: maxReports,
        p_max_source_bytes: maxSourceBytes,
      });
      if (claimResult.error) throw claimResult.error;
      const claim = parseFeedbackDigestClaim(claimResult.data);
      if (!claim.batchId || claim.reports.length === 0) break;

      const email = buildFeedbackDigestEmail(claim.reports, now);
      if (feedbackDigestEmailBytes(email) > MAX_FEEDBACK_DIGEST_EMAIL_BYTES)
        throw new Error("Feedback digest exceeded the safe email byte limit.");

      const started = await supabase.rpc("begin_feedback_digest_delivery", {
        p_batch_id: claim.batchId,
      });
      if (started.error) throw started.error;
      if (started.data !== true)
        throw new Error("Feedback digest batch was not ready for delivery.");

      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${requiredEnvironment("RESEND_API_KEY")}`,
          "content-type": "application/json",
          "idempotency-key": feedbackDigestIdempotencyKey(claim.batchId),
        },
        body: JSON.stringify({
          from: requiredEnvironment("FEEDBACK_DIGEST_FROM"),
          to: [requiredEnvironment("FEEDBACK_DIGEST_TO")],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      });
      const resendBody = (await resendResponse.json()) as {
        id?: unknown;
        message?: unknown;
      };
      const providerEmailId =
        typeof resendBody.id === "string" ? resendBody.id : undefined;
      if (!resendResponse.ok || providerEmailId === undefined) {
        const errorMessage =
          typeof resendBody.message === "string"
            ? resendBody.message
            : `Resend returned ${resendResponse.status}.`;
        await supabase.rpc("fail_feedback_digest", {
          p_batch_id: claim.batchId,
          p_error: errorMessage,
        });
        console.error("Feedback digest delivery failed:", errorMessage);
        return jsonResponse({ error: "Feedback digest delivery failed." }, 502);
      }

      const completion = await supabase.rpc("complete_feedback_digest", {
        p_batch_id: claim.batchId,
        p_provider_email_id: providerEmailId,
      });
      if (completion.error) throw completion.error;
      deliveries.push({
        batchId: claim.batchId,
        providerEmailId,
        reportCount: claim.reports.length,
      });
    }

    return jsonResponse({
      emailed: deliveries.length > 0,
      emailCount: deliveries.length,
      reportCount: deliveries.reduce(
        (total, delivery) => total + delivery.reportCount,
        0,
      ),
      deliveries,
      deleted,
    });
  } catch (error) {
    console.error(
      "Feedback digest job failed:",
      error instanceof Error ? error.message : String(error),
    );
    return jsonResponse({ error: "Feedback digest job failed." }, 500);
  }
});
