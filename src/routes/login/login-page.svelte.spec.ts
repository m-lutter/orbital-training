import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import LoginPage from "./+page.svelte";
import type { ActionData, PageData } from "./$types";

function renderLogin(form: ActionData = null) {
  return render(LoginPage, {
    props: {
      data: {
        accountDeleted: false,
        emailConfirmed: false,
        turnstileSiteKey: null,
      } as PageData,
      form,
    },
  });
}

describe("login page", () => {
  it("preserves the typed email when password visibility changes", async () => {
    renderLogin();
    const email = page.getByLabelText("Email");

    await email.fill("lifter@example.com");
    await page.getByRole("button", { name: "Show" }).click();

    await expect.element(email).toHaveValue("lifter@example.com");
    await expect
      .element(page.getByRole("button", { name: "Hide" }))
      .toBeInTheDocument();
  });

  it("makes the email-confirmation gate explicit after signup", async () => {
    renderLogin({
      email: "lifter@example.com",
      signupPending: true,
      message: "Check your email to finish creating your account.",
    });

    await expect
      .element(
        page.getByText("Check your email to finish creating your account"),
      )
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(/You cannot proceed until the address is\s+confirmed/);
  });
});
