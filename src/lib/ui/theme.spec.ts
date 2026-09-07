import { describe, expect, it } from "vitest";
import { parseAppTheme, themeCookie } from "./theme";

describe("appearance preference", () => {
  it("accepts only known theme names", () => {
    expect(parseAppTheme("orbital")).toBe("orbital");
    expect(parseAppTheme("cute")).toBe("cute");
    expect(parseAppTheme("<script>")).toBeUndefined();
  });

  it("writes a bounded first-party preference cookie", () => {
    expect(themeCookie("cute", true)).toBe(
      "app_theme=cute; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
  });
});
