import { describe, expect, it } from "vitest";
import {
  buildFeedbackDigestEmail,
  feedbackDigestEmailBytes,
  DEFAULT_FEEDBACK_RETENTION_DAYS,
  feedbackDigestIdempotencyKey,
  isFeedbackDigestDeliveryWindow,
  parseFeedbackDigestClaim,
  type FeedbackDigestReport,
} from "../../../supabase/functions/_shared/feedback-digest";

const report: FeedbackDigestReport = {
  id: "f1000000-0000-4000-8000-000000000001",
  userId: "51000000-0000-4000-8000-000000000001",
  userEmail: "lifter@example.test",
  programId: "e1000000-0000-4000-8000-000000000001",
  category: "bug",
  message: "The workout <button> disappeared & blocked my session.",
  blockedUser: true,
  mayContact: true,
  pagePath: "/programs/example/workouts/day-1",
  appVersion: "0.0.1-beta.6",
  clientContext: {
    viewportWidth: 390,
    viewportHeight: 844,
    standalone: true,
    browserFamily: "Chromium",
  },
  status: "new",
  createdAt: "2026-08-23T12:30:00.000Z",
};

describe("feedback digest", () => {
  it("uses the agreed retention period and an idempotency key per stable batch", () => {
    expect(DEFAULT_FEEDBACK_RETENTION_DAYS).toBe(90);
    expect(
      feedbackDigestIdempotencyKey("71000000-0000-4000-8000-000000000001"),
    ).toBe("feedback-digest/71000000-0000-4000-8000-000000000001");
  });

  it("recognizes 8 AM in Chicago across daylight-saving changes", () => {
    expect(
      isFeedbackDigestDeliveryWindow(new Date("2026-08-23T13:00:00Z")),
    ).toBe(true);
    expect(
      isFeedbackDigestDeliveryWindow(new Date("2026-08-23T14:00:00Z")),
    ).toBe(false);
    expect(
      isFeedbackDigestDeliveryWindow(new Date("2026-01-23T14:00:00Z")),
    ).toBe(true);
  });

  it("includes associated report information and escapes stored text in HTML", () => {
    const email = buildFeedbackDigestEmail(
      [report],
      new Date("2026-08-23T13:00:00Z"),
    );
    expect(email.subject).toContain("1 new feedback report");
    expect(email.text).toContain("Contact email: lifter@example.test");
    expect(email.text).toContain("Blocked user: YES");
    expect(email.text).toContain("Program reference: P-E1000000");
    expect(email.text).not.toContain(report.programId);
    expect(email.text).not.toContain(report.userId);
    expect(email.html).toContain("&lt;button&gt;");
    expect(email.html).toContain("&amp; blocked");
    expect(email.html).not.toContain("<button> disappeared");
    expect(feedbackDigestEmailBytes(email)).toBeGreaterThan(0);
  });

  it("does not expose a contact email when contact permission is absent", () => {
    const claim = parseFeedbackDigestClaim({
      batchId: "71000000-0000-4000-8000-000000000001",
      reports: [
        {
          ...report,
          mayContact: false,
          userEmail: null,
        },
      ],
    });
    expect(claim.reports).toHaveLength(1);
    expect(claim.reports[0]?.userEmail).toBeUndefined();
    expect(buildFeedbackDigestEmail(claim.reports).text).not.toContain(
      "Contact email:",
    );
  });
});
