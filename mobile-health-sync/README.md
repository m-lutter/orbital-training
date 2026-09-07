# Orbital Health Sync companion

This Expo development-client app is the native bridge between Orbital Training
and Apple Health (iOS) or Health Connect (Android). The browser app cannot read
either device health store directly.

## What this phase does

- Signs in with the same Supabase account as `orbital-training.com`.
- Lets the user opt into individual read categories and optional completed
  workout writes.
- Sends records to `POST /api/fitness/mobile/sync` on the Cloudflare Worker with
  the user's Supabase access token. It never contains a service-role key.
- Runs one bounded sync per local day when the app opens. A foreground resume
  retries only when a prior read/upload was incomplete or failed.
- Supports explicit workout start/end controls and the web deep links
  `orbitalhealth://workout?...`, `/start?...`, and `/stop`.
- While a workout is active and this app remains foregrounded, checks for new
  heart-rate samples every 30 seconds. Polls overlap by two minutes so samples
  delivered slightly late are not missed.
- Keeps a pending completed workout on the device after a failed upload and
  retries it the next time the app opens or resumes.

Apple Health statistics and Health Connect aggregate APIs merge overlapping
phone/watch sources for cumulative steps and active energy. Normal daily heart
rate is reduced on-device to five-minute statistics; explicit workouts retain
precise raw samples and resumable cursors. Sleep, resting heart rate, HRV, and
workouts use bounded snapshots/anchors appropriate to their storage contract.

## Prerequisites

- The fitness migrations and `/api/fitness/mobile/sync` endpoint must be
  deployed before the companion can upload.
- Use a custom Expo development build or signed build. Expo Go cannot load the
  HealthKit and Health Connect native modules.
- HealthKit testing requires an iPhone. Health Connect needs to be available and
  configured on the Android device or emulator.
- Configure the Supabase project to allow the same email/password sign-in flow
  as the web app.

## Local setup

1. From this directory, copy `.env.example` to `.env.local`.
2. Set:
   - `EXPO_PUBLIC_SUPABASE_URL` to the existing Supabase project URL.
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to its publishable/anon client key.
   - `EXPO_PUBLIC_APP_ORIGIN` to `https://orbital-training.com` for production.
   - Unique production values for `IOS_BUNDLE_IDENTIFIER` and
     `ANDROID_PACKAGE` before publishing.
3. Install this directory's dependencies with `npm install`.
4. Create native projects with `npm run prebuild`.
5. Run `npm run ios` or `npm run android`, or create an EAS development build.
6. Sign in, enable the desired categories, and tap **Save and request
   permissions**.

That Save action is also the explicit server-side connect/reconnect boundary.
An ordinary sync cannot reactivate a source that was disconnected in Orbital.

For a physical device to call a local Worker, `localhost` is not the development
computer. Use a reachable HTTPS tunnel or suitable LAN origin and ensure that
the server intentionally accepts it. Production builds should use the canonical
HTTPS origin.

## Checks

After dependencies are installed:

```powershell
npm run typecheck
npm test
```

Run these commands from `mobile-health-sync`, not the web-app root.

`npm audit --omit=dev` currently reports moderate advisories in transitive
`uuid` versions pulled in by Expo configuration tooling and the Health Connect
package. The automated force-fix proposes a breaking Health Connect downgrade,
so do not apply it blindly. Recheck after Expo and `react-native-health-connect`
updates, and review the resolved dependency tree before accepting a release.

## Platform setup before release

### iOS

- Replace the example bundle identifier and create the matching App ID and
  signing profile in the Apple Developer account.
- Enable the HealthKit capability for the App ID.
- Review the Health share/update descriptions in `app.config.ts`.
- Build and test permission denial, partial permission, reinstall, and revoked
  permission cases on a physical iPhone.

### Android

- Replace the example package name and configure signing/EAS credentials.
- Complete the Play Console Health Apps declaration and publish an accurate
  privacy policy before broad distribution.
- Verify every requested Health Connect record permission is justified by a
  visible feature, and test with permissions later revoked in system settings.

## Important limitations

- A 30-second poll is not a 30-second sensor sample guarantee. The phone can
  upload only records that the watch, source app, and operating system have
  already written to Apple Health or Health Connect. Delivery latency varies.
- This phase does not run a native watchOS workout session and does not stream
  directly from an Apple Watch or another wearable. A watch-native component is
  the next step if guaranteed live, high-frequency workout telemetry is needed.
- Background execution is deliberately not requested or relied upon. Mobile operating
  systems schedule background work opportunistically, so this phase uses
  foreground polling plus deterministic catch-up on resume. A later phase can
  add best-effort background work without promising continuous background sync.
- If the companion is force-quit, active polling stops. When reopened, the
  overlap/catch-up window imports samples recorded while it was away.
- HealthKit does not reveal whether the user denied individual read categories.
  An empty result can mean either no data or no read permission; the app must not
  infer or display a denial.
- The deployed endpoint targets recognized detailed heart-rate and workout
  deletion IDs; daily aggregates reconcile through snapshots, disconnect, and
  retention.

## Security and data boundaries

- Only public Supabase configuration and the public app origin belong in
  `EXPO_PUBLIC_*` variables.
- Never place the Supabase service-role key, wearable OAuth secrets, or database
  credentials in this app or EAS public variables.
- The Worker derives the user from the bearer token and must ignore the body's
  advisory `userId` for authorization.
- Permission selection is stored per user and provider on the device. Revoking a
  category stops future reads; use Orbital's account controls to disconnect and
  delete already-uploaded data.
- Supabase auth sessions use Expo SecureStore (iOS Keychain / Android Keystore),
  while non-secret cursor and permission state remains in AsyncStorage.
