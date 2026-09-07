import type { Session } from "@supabase/supabase-js";
import { StatusBar } from "expo-status-bar";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "./src/auth/supabase";
import {
  HEALTH_DATA_LABELS,
  DEFAULT_PERMISSION_SELECTION,
  heartRateOnlySelection,
  withReadPermission,
} from "./src/health/permissions";
import {
  HEALTH_DATA_TYPES,
  type HealthPermissionSelection,
  type SyncTrigger,
} from "./src/health/types";
import { createMobileRuntime } from "./src/runtime";
import type { SyncResult } from "./src/sync/engine";
import { parseWorkoutDeepLink } from "./src/workout/deep-link";
import type { StoredWorkout } from "./src/workout/workout-lifecycle";

type Notice = { readonly kind: "info" | "error"; readonly text: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function syncDescription(result: SyncResult): string {
  if (result.status === "skipped") {
    if (result.reason === "not_due") return "Health data is already current.";
    if (result.reason === "no_permissions")
      return "Choose at least one health category before syncing.";
    return "Health data is unavailable on this device.";
  }
  const suffix = result.truncated
    ? " More records will be caught up next time."
    : "";
  return `Synced ${result.records} record${result.records === 1 ? "" : "s"}.${suffix}`;
}

function formatTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}

function PrimaryButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.button,
        props.danger ? styles.dangerButton : styles.primaryButton,
        pressed && !props.disabled ? styles.buttonPressed : null,
        props.disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const authenticate = async (mode: "sign-in" | "sign-up") => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setNotice({ kind: "error", text: "Enter your email and password." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        if (!data.session)
          setNotice({
            kind: "info",
            text: "Check your inbox and verify your email, then return here to sign in.",
          });
      }
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authContainer}>
          <Text style={styles.eyebrow}>ORBITAL TRAINING</Text>
          <Text style={styles.title}>Health Sync</Text>
          <Text style={styles.subtitle}>
            Sign in with the same account you use at orbital-training.com.
          </Text>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#7f879b"
            style={styles.input}
            value={email}
          />
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="current-password"
            onChangeText={setPassword}
            onSubmitEditing={() => void authenticate("sign-in")}
            placeholder="Password"
            placeholderTextColor="#7f879b"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          {notice ? (
            <Text
              accessibilityLiveRegion="polite"
              style={notice.kind === "error" ? styles.error : styles.notice}
            >
              {notice.text}
            </Text>
          ) : null}
          {busy ? (
            <ActivityIndicator color="#a8b9ff" />
          ) : (
            <View style={styles.buttonStack}>
              <PrimaryButton
                label="Sign in"
                onPress={() => void authenticate("sign-in")}
              />
              <PrimaryButton
                label="Create account"
                onPress={() => void authenticate("sign-up")}
              />
            </View>
          )}
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function HealthApp(props: { readonly session: Session }) {
  const userId = props.session.user.id;
  const runtime = useMemo(() => createMobileRuntime(userId), [userId]);
  const [selection, setSelection] = useState<HealthPermissionSelection>(
    DEFAULT_PERMISSION_SELECTION,
  );
  const [savedSelection, setSavedSelection] =
    useState<HealthPermissionSelection>(DEFAULT_PERMISSION_SELECTION);
  const [activeWorkout, setActiveWorkout] = useState<StoredWorkout>();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availabilityReason, setAvailabilityReason] = useState<string>();
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const polling = useRef(false);
  const mounted = useRef(true);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const refreshWorkout = useCallback(async () => {
    const workout = await runtime.workouts.getActive();
    if (mounted.current) setActiveWorkout(workout);
    return workout;
  }, [runtime]);

  const refreshLastSuccess = useCallback(async () => {
    const value = await runtime.store.getLastSuccess(
      userId,
      runtime.provider.name,
    );
    if (mounted.current) setLastSuccess(value);
  }, [runtime, userId]);

  const runSync = useCallback(
    async (trigger: SyncTrigger, showResult = true) => {
      const result = await runtime.engine.sync(trigger);
      await refreshLastSuccess();
      if (showResult && mounted.current)
        setNotice({ kind: "info", text: syncDescription(result) });
      return result;
    },
    [refreshLastSuccess, runtime],
  );

  const pollActiveWorkout = useCallback(
    async (workout: StoredWorkout) => {
      if (polling.current || workout.endedAt) return;
      polling.current = true;
      try {
        const permissions = await runtime.store.getPermissions(
          userId,
          runtime.provider.name,
        );
        if (!permissions.read.heart_rate) return;
        const result = await runtime.engine.sync("foreground_catch_up", {
          force: true,
          selection: heartRateOnlySelection(permissions),
          activeWorkoutStartedAt: workout.startedAt,
          ...(workout.programId && workout.sessionId
            ? {
                activeWorkoutSourceSessionKey: `${workout.programId}:${workout.sessionId}`,
              }
            : {}),
        });
        if (result.workoutCapture?.endedAt) {
          const cleared = await runtime.workouts.acknowledgeServerEnd(
            result.workoutCapture.sourceSessionKey,
          );
          if (cleared && mounted.current) setActiveWorkout(undefined);
        }
        await refreshLastSuccess();
      } catch (error) {
        await runtime.store.markCatchUpNeeded(userId, runtime.provider.name);
        if (mounted.current) setNotice({ kind: "error", text: message(error) });
      } finally {
        polling.current = false;
      }
    },
    [refreshLastSuccess, runtime, userId],
  );

  const resume = useCallback(async () => {
    try {
      await runtime.workouts.flushPendingStop();
      await runSync("foreground_catch_up", false);
      const workout = await refreshWorkout();
      if (workout) await pollActiveWorkout(workout);
    } catch (error) {
      if (mounted.current) setNotice({ kind: "error", text: message(error) });
    }
  }, [pollActiveWorkout, refreshWorkout, runSync, runtime]);

  useEffect(() => {
    mounted.current = true;
    const initialize = async () => {
      try {
        const [availability, permissions] = await Promise.all([
          runtime.provider.getAvailability(),
          runtime.store.getPermissions(userId, runtime.provider.name),
        ]);
        if (!mounted.current) return;
        setAvailable(availability.available);
        setAvailabilityReason(availability.reason);
        setSelection(permissions);
        setSavedSelection(permissions);
        await runtime.workouts.flushPendingStop();
        await refreshWorkout();
        await runSync("app_open_daily", false);
      } catch (error) {
        if (mounted.current) setNotice({ kind: "error", text: message(error) });
      }
    };
    void initialize();
    return () => {
      mounted.current = false;
    };
  }, [refreshWorkout, runSync, runtime, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        const previous = appState.current;
        appState.current = nextState;
        if (nextState === "active" && previous !== "active") void resume();
      },
    );
    return () => subscription.remove();
  }, [resume, runtime, userId]);

  useEffect(() => {
    if (!activeWorkout || activeWorkout.endedAt) return;
    const interval = setInterval(() => {
      if (appState.current === "active") void pollActiveWorkout(activeWorkout);
    }, 30_000);
    return () => clearInterval(interval);
  }, [activeWorkout, pollActiveWorkout]);

  useEffect(() => {
    const handleUrl = async (url: string) => {
      const action = parseWorkoutDeepLink(url);
      if (!action) return;
      try {
        if (action.type === "start") await runtime.workouts.start(action);
        else await runtime.workouts.stop();
        await refreshWorkout();
      } catch (error) {
        await refreshWorkout();
        if (mounted.current) setNotice({ kind: "error", text: message(error) });
      }
    };
    void Linking.getInitialURL().then((url: string | null) => {
      if (url) return handleUrl(url);
    });
    const subscription = Linking.addEventListener(
      "url",
      ({ url }: { url: string }) => {
        void handleUrl(url);
      },
    );
    return () => subscription.remove();
  }, [refreshWorkout, runtime]);

  const savePermissions = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await runtime.provider.requestPermissions(selection);
      await runtime.store.setPermissions(
        userId,
        runtime.provider.name,
        selection,
      );
      setSavedSelection(selection);
      await runtime.transport.connect(runtime.provider.name, selection);
      const result = await runtime.engine.sync("manual", { selection });
      await refreshLastSuccess();
      setNotice({
        kind: "info",
        text: `Permissions saved. ${syncDescription(result)}`,
      });
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const startWorkout = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const workout = await runtime.workouts.start();
      setActiveWorkout(workout);
      setNotice({
        kind: "info",
        text: "Workout started. Heart-rate catch-up runs every 30 seconds while this app is open.",
      });
    } catch (error) {
      await refreshWorkout();
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const stopWorkout = async () => {
    setBusy(true);
    setNotice(null);
    try {
      if (activeWorkout?.endedAt) await runtime.workouts.flushPendingStop();
      else await runtime.workouts.stop();
      setNotice({ kind: "info", text: "Workout ended and uploaded." });
    } catch (error) {
      setNotice({
        kind: "error",
        text: `${message(error)} The completed workout remains on this device and will retry when the app resumes.`,
      });
    } finally {
      await refreshWorkout();
      setBusy(false);
    }
  };

  const manualSync = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await runSync("manual");
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ORBITAL TRAINING</Text>
            <Text style={styles.title}>Health Sync</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void supabase.auth.signOut()}
          >
            <Text style={styles.link}>Sign out</Text>
          </Pressable>
        </View>

        {notice ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.card,
              notice.kind === "error" ? styles.errorCard : null,
            ]}
          >
            <Text
              style={notice.kind === "error" ? styles.error : styles.notice}
            >
              {notice.text}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connection</Text>
          <Text style={styles.body}>
            {available === null
              ? "Checking this device…"
              : available
                ? `${runtime.provider.name === "apple_healthkit" ? "Apple Health" : "Health Connect"} is available.`
                : availabilityReason || "Health data is unavailable."}
          </Text>
          <Text style={styles.meta}>
            Last successful sync: {formatTime(lastSuccess)}
          </Text>
          <PrimaryButton
            disabled={busy || available !== true}
            label={busy ? "Working…" : "Sync now"}
            onPress={() => void manualSync()}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data permissions</Text>
          <Text style={styles.body}>
            Orbital reads only the categories enabled here. You can turn off a
            category at any time; device-level permission changes happen in
            Health settings.
          </Text>
          {HEALTH_DATA_TYPES.map((type) => (
            <View key={type} style={styles.settingRow}>
              <Text style={styles.settingLabel}>
                {HEALTH_DATA_LABELS[type]}
              </Text>
              <Switch
                accessibilityLabel={`Read ${HEALTH_DATA_LABELS[type]}`}
                onValueChange={(enabled: boolean) =>
                  setSelection((current: HealthPermissionSelection) =>
                    withReadPermission(current, type, enabled),
                  )
                }
                trackColor={{ false: "#41475a", true: "#657ce8" }}
                value={selection.read[type]}
              />
            </View>
          ))}
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingLabel}>Save completed workouts</Text>
              <Text style={styles.meta}>Optional write access</Text>
            </View>
            <Switch
              onValueChange={(enabled: boolean) =>
                setSelection((current: HealthPermissionSelection) => ({
                  ...current,
                  writeCompletedWorkouts: enabled,
                }))
              }
              trackColor={{ false: "#41475a", true: "#657ce8" }}
              value={selection.writeCompletedWorkouts}
            />
          </View>
          <View style={styles.buttonStack}>
            <PrimaryButton
              disabled={busy || available !== true}
              label="Save and request permissions"
              onPress={() => void savePermissions()}
            />
            <PrimaryButton
              label="Open device health settings"
              onPress={() => void runtime.provider.openPermissionSettings()}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Workout capture</Text>
          {activeWorkout ? (
            <>
              <Text style={styles.body}>
                {activeWorkout.endedAt
                  ? "This workout ended, but its final upload is pending."
                  : "Workout active"}
              </Text>
              <Text style={styles.meta}>
                Started {formatTime(activeWorkout.startedAt)}
              </Text>
              <PrimaryButton
                danger={!activeWorkout.endedAt}
                disabled={busy}
                label={
                  activeWorkout.endedAt ? "Retry final upload" : "End workout"
                }
                onPress={() => void stopWorkout()}
              />
            </>
          ) : (
            <>
              <Text style={styles.body}>
                Start and end capture explicitly. While active and foregrounded,
                the app checks for new heart-rate samples every 30 seconds.
              </Text>
              <PrimaryButton
                disabled={busy || !savedSelection.read.heart_rate}
                label="Start workout"
                onPress={() => void startWorkout()}
              />
              {!savedSelection.read.heart_rate ? (
                <Text style={styles.meta}>
                  Enable and save Heart rate before starting capture.
                </Text>
              ) : null}
            </>
          )}
        </View>

        <Text style={styles.footer}>
          Signed in as {props.session.user.email || "your Orbital account"}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      <StatusBar style="light" />
      {session === undefined ? (
        <SafeAreaView style={styles.loading}>
          <ActivityIndicator color="#a8b9ff" size="large" />
        </SafeAreaView>
      ) : session ? (
        <HealthApp session={session} />
      ) : (
        <AuthScreen />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#080b14" },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#080b14",
  },
  page: { padding: 20, paddingBottom: 44, gap: 16 },
  authContainer: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: "#8296ef",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.8,
  },
  title: { color: "#f7f8ff", fontSize: 34, fontWeight: "800" },
  subtitle: { color: "#aeb5c9", fontSize: 16, lineHeight: 23 },
  card: {
    borderWidth: 1,
    borderColor: "#293148",
    borderRadius: 18,
    padding: 18,
    gap: 12,
    backgroundColor: "#111726",
  },
  errorCard: { borderColor: "#7c3545", backgroundColor: "#21131b" },
  cardTitle: { color: "#f7f8ff", fontSize: 20, fontWeight: "700" },
  body: { color: "#c8cede", fontSize: 15, lineHeight: 22 },
  meta: { color: "#929bb1", fontSize: 13, lineHeight: 18 },
  notice: { color: "#bdc9ff", fontSize: 14, lineHeight: 20 },
  error: { color: "#ff9cad", fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: "#303952",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#f7f8ff",
    backgroundColor: "#111726",
    fontSize: 16,
  },
  buttonStack: { gap: 10 },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButton: { backgroundColor: "#566ed9" },
  dangerButton: { backgroundColor: "#a53f57" },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  link: { color: "#a8b9ff", fontSize: 14, fontWeight: "700" },
  settingRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2a3248",
  },
  settingCopy: { flex: 1, paddingVertical: 6 },
  settingLabel: { color: "#e8eaf3", fontSize: 15, flex: 1 },
  footer: { color: "#70798e", fontSize: 12, textAlign: "center" },
});
