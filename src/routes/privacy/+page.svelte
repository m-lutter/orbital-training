<svelte:head>
  <title>Privacy | Orbital Training</title>
  <meta
    name="description"
    content="How Orbital Training collects, uses, retains, and protects training data."
  />
</svelte:head>

<main class="mission-page legal-page">
  <article class="mission-panel">
    <p class="mission-kicker">Last updated August 27, 2026</p>
    <h1>Privacy notice</h1>
    <p>
      Orbital Training uses the information you provide to create and adapt
      training programs, save workouts, operate your account, and improve the
      beta. It does not sell your personal information.
    </p>

    <h2>Information the app stores</h2>
    <ul>
      <li>Your account email and authentication records.</li>
      <li>
        Profile, questionnaire, training-goal, availability, equipment, and
        program information.
      </li>
      <li>
        Workout logs, performance and effort entries, movement check-ins, weekly
        reviews, and pain or limitation information you choose to enter.
      </li>
      <li>
        If you opt into a fitness connection: the provider, granted categories,
        consent events, daily steps and recovery summaries, workout summaries,
        and five-minute heart-rate buckets used for retrospective weekly-review
        charts. Some device-import paths may briefly retain detailed samples
        while normalizing them, but the web app does not use them for live
        workout feedback.
      </li>
      <li>
        Beta feedback. A report includes its message, category, current page,
        app version, screen dimensions, installed-app status, and a broad
        browser family. Your email is included in the administrator digest only
        when you permit contact.
      </li>
      <li>
        Operational logs needed for security, reliability, abuse prevention, and
        cost monitoring. Application logs are designed not to contain passwords
        or complete training records.
      </li>
    </ul>

    <h2>How the information is used</h2>
    <p>
      Information is used to provide the requested training service, preserve
      training history, personalize recommendations, respond to feedback,
      prevent abuse, diagnose failures, and maintain the security and
      performance of the service. Training and pain information is not used as
      medical diagnosis or treatment. Connected steps can satisfy a movement
      target without manual entry. Simplified recovery trends can conservatively
      pause an otherwise supported progression, but wearable data does not
      reduce training or make a health inference by itself.
    </p>

    <h2>Service providers</h2>
    <p>
      Supabase provides authentication and database services. Cloudflare
      provides application hosting, delivery, and security services. Resend
      delivers administrator feedback digests and may deliver account email
      after production email setup is completed. If you connect it, Google
      provides the categories you authorize. Apple Health or Health Connect data
      is read by the optional mobile companion and sent to Orbital only after
      device permission and account authentication. These providers process
      information under their own terms and privacy practices.
    </p>

    <h2>Retention and your choices</h2>
    <p>
      Account and training information is retained while your account remains
      active. Beta feedback is automatically deleted 90 days after submission,
      whether or not it has been reviewed. Any detailed heart-rate samples from
      a supported import path are automatically deleted after seven days;
      five-minute heart-rate buckets are retained for up to 400 days. Private
      provider audit events are retained for up to 365 days; consent history is
      retained with your account. Limited provider backups and security logs may
      persist for their normal backup or abuse-prevention periods. From Account,
      you can disconnect a provider, optionally delete its uploaded health data,
      download your account data, or permanently delete your account and
      associated application data.
    </p>

    <h2>Security and health connections</h2>
    <p>
      The app uses authenticated access and database row-level controls to keep
      each user’s records separate. Cloud-provider access and refresh tokens are
      encrypted before storage and are never sent to the browser or mobile
      companion. Raw heart-rate rows are not directly readable by browser
      clients. Each connection is optional and requires clear provider or device
      authorization; disconnecting stops future sync, and selecting deletion
      removes that connection’s uploaded health data. Reconnecting begins a new
      connection generation and clears retained data for that provider before
      importing again, which prevents records from different upstream accounts
      from being combined.
    </p>

    <h2>Contact</h2>
    <p>
      For privacy questions or requests that cannot be completed from Account,
      signed-in users can use the in-app Beta feedback form and allow a reply.
      Do not include health information or other sensitive details in a public
      GitHub issue.
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
  p,
  li {
    line-height: 1.65;
  }
  li + li {
    margin-top: 0.45rem;
  }
</style>
