export const FEEDBACK_DIGEST_TIME_ZONE = "America/Chicago";
export const FEEDBACK_DIGEST_HOUR = 8;
export const DEFAULT_FEEDBACK_RETENTION_DAYS = 90;
export const DEFAULT_FEEDBACK_DIGEST_MAX_REPORTS = 25;
export const DEFAULT_FEEDBACK_DIGEST_MAX_SOURCE_BYTES = 100_000;
export const DEFAULT_FEEDBACK_DIGEST_MAX_EMAILS = 5;
export const MAX_FEEDBACK_DIGEST_EMAIL_BYTES = 1_000_000;

export interface FeedbackDigestReport {
  id: string;
  userId: string;
  userEmail?: string;
  programId?: string;
  category: "bug" | "confusing" | "idea" | "other";
  message: string;
  blockedUser: boolean;
  mayContact: boolean;
  pagePath: string;
  appVersion: string;
  clientContext: Record<string, unknown>;
  status: string;
  createdAt: string;
}

export interface FeedbackDigestClaim {
  batchId?: string;
  reports: FeedbackDigestReport[];
}

export interface FeedbackDigestEmail {
  subject: string;
  text: string;
  html: string;
}

const CATEGORY_LABELS: Record<FeedbackDigestReport["category"], string> = {
  bug: "Something isn't working",
  confusing: "Something is confusing",
  idea: "Idea",
  other: "Other feedback",
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseFeedbackDigestClaim(value: unknown): FeedbackDigestClaim {
  const claim = recordValue(value);
  const reports = Array.isArray(claim.reports) ? claim.reports : [];
  return {
    batchId: stringValue(claim.batchId),
    reports: reports.flatMap((raw): FeedbackDigestReport[] => {
      const report = recordValue(raw);
      const id = stringValue(report.id);
      const userId = stringValue(report.userId);
      const category = stringValue(report.category);
      const message = stringValue(report.message);
      const pagePath = stringValue(report.pagePath);
      const appVersion = stringValue(report.appVersion);
      const createdAt = stringValue(report.createdAt);
      if (
        id === undefined ||
        userId === undefined ||
        !["bug", "confusing", "idea", "other"].includes(category ?? "") ||
        message === undefined ||
        pagePath === undefined ||
        appVersion === undefined ||
        createdAt === undefined
      )
        return [];
      return [
        {
          id,
          userId,
          ...(stringValue(report.userEmail) === undefined
            ? {}
            : { userEmail: stringValue(report.userEmail) }),
          ...(stringValue(report.programId) === undefined
            ? {}
            : { programId: stringValue(report.programId) }),
          category: category as FeedbackDigestReport["category"],
          message,
          blockedUser: report.blockedUser === true,
          mayContact: report.mayContact === true,
          pagePath,
          appVersion,
          clientContext: recordValue(report.clientContext),
          status: stringValue(report.status) ?? "new",
          createdAt,
        },
      ];
    }),
  };
}

export function isFeedbackDigestDeliveryWindow(now: Date): boolean {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: FEEDBACK_DIGEST_TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour) === FEEDBACK_DIGEST_HOUR;
}

export function feedbackReference(id: string): string {
  return `F-${id.slice(0, 8).toUpperCase()}`;
}

export function feedbackDigestIdempotencyKey(batchId: string): string {
  return `feedback-digest/${batchId}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function submittedLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.valueOf())) return createdAt;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FEEDBACK_DIGEST_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function contextLines(context: Record<string, unknown>): string[] {
  return [
    context.viewportWidth === undefined || context.viewportHeight === undefined
      ? undefined
      : `Viewport: ${String(context.viewportWidth)} × ${String(context.viewportHeight)}`,
    `Installed/PWA: ${context.standalone === true ? "yes" : "no"}`,
    stringValue(context.browserFamily) === undefined
      ? undefined
      : `Browser family: ${stringValue(context.browserFamily)}`,
  ].filter((line): line is string => line !== undefined);
}

function programReference(id: string): string {
  return `P-${id.slice(0, 8).toUpperCase()}`;
}

function plainTextReport(report: FeedbackDigestReport, index: number): string {
  return [
    `${index + 1}. ${feedbackReference(report.id)} — ${CATEGORY_LABELS[report.category]}`,
    `Submitted: ${submittedLabel(report.createdAt)}`,
    `Status: ${report.status}`,
    `Blocked user: ${report.blockedUser ? "YES" : "no"}`,
    `Contact permitted: ${report.mayContact ? "yes" : "no"}`,
    ...(report.mayContact && report.userEmail
      ? [`Contact email: ${report.userEmail}`]
      : []),
    ...(report.programId
      ? [`Program reference: ${programReference(report.programId)}`]
      : []),
    `Page: ${report.pagePath}`,
    `App version: ${report.appVersion}`,
    ...contextLines(report.clientContext),
    "",
    report.message,
  ].join("\n");
}

function htmlReport(report: FeedbackDigestReport): string {
  const metadata = [
    ["Submitted", submittedLabel(report.createdAt)],
    ["Status", report.status],
    ["Blocked user", report.blockedUser ? "YES" : "no"],
    ["Contact permitted", report.mayContact ? "yes" : "no"],
    ...(report.mayContact && report.userEmail
      ? [["Contact email", report.userEmail]]
      : []),
    ...(report.programId
      ? [["Program reference", programReference(report.programId)]]
      : []),
    ["Page", report.pagePath],
    ["App version", report.appVersion],
    ...contextLines(report.clientContext).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator), line.slice(separator + 1).trim()];
    }),
  ];
  return `<article style="border:1px solid #d8dee9;border-radius:8px;margin:0 0 20px;padding:16px">
    <h2 style="margin:0 0 12px">${escapeHtml(feedbackReference(report.id))} — ${escapeHtml(CATEGORY_LABELS[report.category])}</h2>
    <table style="border-collapse:collapse;font-size:14px;margin-bottom:14px">
      ${metadata
        .map(
          ([label, value]) =>
            `<tr><th style="padding:3px 12px 3px 0;text-align:left;vertical-align:top">${escapeHtml(label)}</th><td style="padding:3px 0">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}
    </table>
    <div style="background:#f6f8fa;border-radius:6px;padding:12px;white-space:pre-wrap">${escapeHtml(report.message)}</div>
  </article>`;
}

export function buildFeedbackDigestEmail(
  reports: FeedbackDigestReport[],
  generatedAt = new Date(),
): FeedbackDigestEmail {
  const countLabel = `${reports.length} new feedback ${reports.length === 1 ? "report" : "reports"}`;
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: FEEDBACK_DIGEST_TIME_ZONE,
    dateStyle: "medium",
  }).format(generatedAt);
  return {
    subject: `[Orbital Training] ${countLabel} — ${dateLabel}`,
    text: [
      `Orbital Training feedback digest: ${countLabel}`,
      "",
      ...reports.flatMap((report, index) => [
        plainTextReport(report, index),
        "",
        "---",
        "",
      ]),
    ].join("\n"),
    html: `<main style="font-family:Arial,sans-serif;line-height:1.45;max-width:760px;margin:auto">
      <h1>Orbital Training feedback digest</h1>
      <p>${escapeHtml(countLabel)} received since the previous successful digest.</p>
      ${reports.map(htmlReport).join("")}
    </main>`,
  };
}

export function feedbackDigestEmailBytes(email: FeedbackDigestEmail): number {
  return new TextEncoder().encode(
    JSON.stringify({
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  ).byteLength;
}
