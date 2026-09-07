<script lang="ts">
  import { SUPPORT_EMAIL } from "$lib/app-meta";
</script>

<svelte:head>
  <title>Terms | Orbital Training</title>
  <meta
    name="description"
    content="Terms for using the Orbital Training beta."
  />
</svelte:head>

<main class="mission-page legal-page">
  <article class="mission-panel">
    <p class="mission-kicker">Last updated August 27, 2026</p>
    <h1>Terms of use</h1>
    <p>
      These terms apply when you use the Orbital Training open beta. By creating
      an account or using the service, you agree to use it lawfully and in
      accordance with these terms.
    </p>

    <h2>Training guidance, not medical care</h2>
    <p>
      Orbital Training provides educational training suggestions, not medical
      diagnosis, treatment, rehabilitation, or emergency advice. Exercise
      involves risk. Use your judgment, choose loads and movements you can
      perform safely, stop when appropriate, and seek a qualified professional
      for medical symptoms or questions. Do not rely on the app in an emergency.
    </p>

    <h2>Your account and information</h2>
    <p>
      You are responsible for accurate account information, maintaining the
      confidentiality of your credentials, and activity performed through your
      account. You retain responsibility for the training and feedback content
      you enter. You permit the service to process that content as described in
      the <a href="/privacy">privacy notice</a> so it can provide and improve the
      service.
    </p>

    <h2>Connected-device data</h2>
    <p>
      Wearables, phones, provider APIs, and operating systems may delay, omit,
      duplicate, or revise fitness measurements. Orbital imports heart-rate data
      retrospectively after a connected source syncs; it does not guarantee live
      delivery or that every workout will have a complete trace. Keep manual
      logging available, verify important records, and do not rely on
      connected-device data for medical or emergency decisions.
    </p>

    <h2>Acceptable use</h2>
    <p>
      Do not attempt to access another user’s data, bypass security or usage
      limits, disrupt the service, automate abusive traffic, introduce harmful
      code, or use the service in a way that violates applicable law or another
      person’s rights.
    </p>

    <h2>Beta availability and changes</h2>
    <p>
      The beta may contain errors and may change. Features may be modified,
      limited, or discontinued, and availability is not guaranteed. Reasonable
      care is taken to protect saved data, but you should use the Account export
      when you need an independent copy of your records.
    </p>

    <h2>Suspension and termination</h2>
    <p>
      Access may be restricted for abuse, security risk, unlawful use, or a
      material violation of these terms. You may end your use at any time and
      permanently delete your account from Account.
    </p>

    <h2>Contact</h2>
    <p>
      Questions about these terms may be sent to
      <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
    </p>
  </article>
</main>

<style>
  .legal-page {
    max-width: 54rem;
  }
  article {
    padding: clamp(1.2rem, 4vw, 2.2rem);
  }
  h1 {
    margin-top: 0.35rem;
  }
  h2 {
    margin-top: 1.7rem;
  }
  p {
    line-height: 1.65;
  }
</style>
