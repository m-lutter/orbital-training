import { describe, expect, it, vi } from "vitest";
import { recentProgramId, rememberRecentProgram } from "./recent-program";

const validId = "123e4567-e89b-42d3-a456-426614174000";

describe("recent program cookie", () => {
  it("rejects an invalid cookie value", () => {
    expect(
      recentProgramId({ get: () => "../another-user", set: vi.fn() }),
    ).toBeUndefined();
  });

  it("writes a scoped, http-only preference", () => {
    const set = vi.fn();
    rememberRecentProgram({ get: () => undefined, set }, validId, true);
    expect(set).toHaveBeenCalledWith(
      "recent_program_id",
      validId,
      expect.objectContaining({
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: true,
      }),
    );
  });
});
