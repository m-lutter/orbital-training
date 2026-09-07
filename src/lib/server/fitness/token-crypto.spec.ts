import { describe, expect, it } from "vitest";
import { decryptFitnessToken, encryptFitnessToken } from "./token-crypto";

const KEY = "test-key-material-that-is-longer-than-thirty-two-characters";

describe("fitness token encryption", () => {
  it("round trips without exposing the plaintext", async () => {
    const encrypted = await encryptFitnessToken("refresh-secret", KEY);
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(encrypted).not.toContain("refresh-secret");
    await expect(decryptFitnessToken(encrypted, KEY)).resolves.toBe(
      "refresh-secret",
    );
  });

  it("rejects an incorrect key", async () => {
    const encrypted = await encryptFitnessToken("refresh-secret", KEY);
    await expect(
      decryptFitnessToken(
        encrypted,
        "different-test-key-material-that-is-still-long-enough",
      ),
    ).rejects.toThrow();
  });

  it("requires appropriately long key material", async () => {
    await expect(encryptFitnessToken("token", "short-key")).rejects.toThrow(
      "at least 32 characters",
    );
  });
});
