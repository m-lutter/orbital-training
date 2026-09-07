import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  const {
    data: { user },
  } = await locals.getUser();

  if (user) {
    redirect(303, "/dashboard");
  }

  return {
    accountDeleted: url.searchParams.get("account") === "deleted",
    emailConfirmed: url.searchParams.get("email") === "confirmed",
    turnstileSiteKey: platform?.env.TURNSTILE_SITE_KEY?.trim() || null,
  };
};

function captchaOptions(formData: FormData, required: boolean) {
  const captchaToken = String(formData.get("captchaToken") ?? "").trim();
  if (required && captchaToken === "")
    return { error: "Complete the security check before continuing." } as const;
  return {
    options: captchaToken === "" ? undefined : { captchaToken },
  } as const;
}

function turnstileRequired(platform: App.Platform | undefined): boolean {
  return platform?.env.TURNSTILE_REQUIRED?.trim().toLowerCase() === "true";
}

export const actions: Actions = {
  login: async ({ request, locals, platform }) => {
    const formData = await request.formData();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      return fail(400, {
        email,
        message: "Enter your email and password.",
      });
    }

    const captcha = captchaOptions(formData, turnstileRequired(platform));
    if ("error" in captcha) return fail(400, { email, message: captcha.error });

    const { error } = await locals.supabase.auth.signInWithPassword({
      email,
      password,
      ...(captcha.options === undefined ? {} : { options: captcha.options }),
    });

    if (error) {
      const emailNotConfirmed = error.code === "email_not_confirmed";
      return fail(400, {
        email,
        message: emailNotConfirmed
          ? "Confirm your email using the link Supabase sent before logging in. Check your spam or junk folder if it is not in your inbox."
          : "The email or password was incorrect.",
      });
    }

    redirect(303, "/dashboard");
  },

  signup: async ({ request, locals, platform, url }) => {
    const formData = await request.formData();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email.includes("@")) {
      return fail(400, {
        email,
        message: "Enter a valid email address.",
      });
    }

    if (password.length < 8) {
      return fail(400, {
        email,
        message: "Use a password containing at least 8 characters.",
      });
    }

    const captcha = captchaOptions(formData, turnstileRequired(platform));
    if ("error" in captcha) return fail(400, { email, message: captcha.error });

    const { data, error } = await locals.supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: new URL(
          "/login?email=confirmed",
          url.origin,
        ).toString(),
        ...(captcha.options ?? {}),
      },
    });

    if (error) {
      console.warn("Account signup was not completed:", { code: error.code });
      return fail(400, {
        email,
        message:
          "The account could not be created. Check the email address and password, then try again.",
      });
    }

    if (!data.session) {
      return {
        email,
        signupPending: true,
        message: "Check your email to finish creating your account.",
      };
    }

    redirect(303, "/dashboard");
  },
};
