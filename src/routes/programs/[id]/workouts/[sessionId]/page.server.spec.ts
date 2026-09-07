import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/engine", () => ({
  readProgramDraft: (value: unknown) => value,
}));

import { actions, load } from "./+page.server";
import { generateProgram, ENGINE_VERSION, POLICY_VERSION } from "$lib/domain";
import { baseInput } from "$lib/domain/tests/fixtures";
import { createStoredProgramV3 } from "$lib/engine/v3";
import { parseProgramDraft } from "$lib/engine/parse";

const PROGRAM_ID = "program-1";
const NOW = "2026-09-01T12:00:00.000Z";

interface FakeResult {
  data: unknown;
  error: { code?: string } | null;
}

class FakeQuery {
  constructor(private readonly result: FakeResult) {}

  select(): this {
    return this;
  }

  eq(): this {
    return this;
  }

  lte(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  maybeSingle(): Promise<FakeResult> {
    return Promise.resolve(this.result);
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function session(weekNumber: number) {
  return {
    id: `w${weekNumber}`,
    weekNumber,
    sequence: 1,
    day: "monday",
    kind: "lifting",
    title: `Week ${weekNumber}`,
    objective: "",
    exercises: [],
    predictedMinutes: 30,
    targetMinutes: 30,
    durationStatus: "fits",
    explanation: "",
  };
}

function draft() {
  return {
    schemaVersion: 3,
    inputSnapshot: {
      history: {
        effortReporting: "rir",
        effortFamiliarity: "basic",
      },
      schedule: { planningStyle: "calendar_days" },
      cardio: { heartRateDevice: "none" },
      facility: {},
    },
    program: {
      version: 1,
      horizonWeeks: 2,
      loadSettings: {
        units: "lb",
        barbellIncrement: 5,
        dumbbellIncrement: 5,
      },
      baselines: [],
      weeks: [
        { weekNumber: 1, sessions: [session(1)] },
        { weekNumber: 2, sessions: [session(2)] },
      ],
    },
  };
}

function workoutLog(weekNumber: number) {
  return {
    id: `log-w${weekNumber}`,
    program_id: PROGRAM_ID,
    program_version: 1,
    session_id: `w${weekNumber}`,
    week_number: weekNumber,
    session_sequence: 1,
    status: "completed",
    exercise_logs: [],
    cardio_log: {},
    movement_log: {},
    duration_minutes: null,
    miss_reason: null,
    started_at: NOW,
    completed_at: NOW,
    updated_at: NOW,
  };
}

function weeklyReview(weekNumber: number) {
  return {
    id: `review-w${weekNumber}`,
    program_id: PROGRAM_ID,
    week_number: weekNumber,
    source_program_version: 1,
    result_program_version: 1,
    decision: "no_change",
    state: "on_track",
    confidence: "moderate",
    metrics: {},
    result: {},
    created_at: NOW,
  };
}

function event(
  sessionId: string,
  logs: unknown[],
  reviews: unknown[],
  payload = draft(),
) {
  const results: Record<string, FakeResult> = {
    programs: {
      data: { id: PROGRAM_ID, name: "Test program", payload },
      error: null,
    },
    workout_logs: { data: logs, error: null },
    weekly_reviews: { data: reviews, error: null },
  };
  return {
    locals: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
      supabase: {
        from(table: string) {
          const result = results[table];
          if (result === undefined)
            throw new Error(`Unexpected table ${table}`);
          return new FakeQuery(result);
        },
      },
    },
    params: { id: PROGRAM_ID, sessionId },
    cookies: { get: () => undefined, set: vi.fn() },
    url: new URL(
      `https://orbital-training.com/programs/${PROGRAM_ID}/workouts/${sessionId}`,
    ),
  } as never;
}

describe("direct workout review gate", () => {
  it("redirects a later-week workout while the prior review is due", async () => {
    await expect(load(event("w2", [workoutLog(1)], []))).rejects.toMatchObject({
      status: 303,
      location: `/programs/${PROGRAM_ID}/reviews/1`,
    });
  });

  it("keeps the review week's workout accessible", async () => {
    const result = await load(
      event("w2", [workoutLog(1), workoutLog(2)], [weeklyReview(1)]),
    );

    expect(result).toMatchObject({
      session: { id: "w2", weekNumber: 2 },
      historyFrozen: false,
    });
  });

  it("keeps reviewed historical workouts accessible", async () => {
    const result = await load(event("w1", [workoutLog(1)], [weeklyReview(1)]));

    expect(result).toMatchObject({
      session: { id: "w1", weekNumber: 1 },
      historyFrozen: true,
    });
  });
});

let cardioCase = 0;
function cardioEvent(
  selected: string | undefined,
  options: {
    saved?: string;
    equipment?: string[];
    preferences?: string[];
    noCardio?: boolean;
    completedIntervals?: number;
  } = {},
) {
  const id = `cardio-${++cardioCase}`;
  const cardio = {
    modality: "running",
    intensity: "hard",
    minutes: 30,
    role: "intervals",
    intervals: { workSeconds: 60, recoverySeconds: 90, repeats: 6 },
    sessionRpe: { min: 7, max: 8 },
    talkTest: "Hard but controlled",
    placement: "Separate",
    ruleIds: [],
  };
  const workout = {
    ...session(1),
    id,
    kind: "cardio",
    ...(options.noCardio ? {} : { cardio }),
  };
  const payload = draft();
  Object.assign(payload.inputSnapshot.cardio, {
    preferredModalities: options.preferences ?? [
      "running",
      "cycling",
      "swimming",
    ],
    avoidRunning: false,
  });
  Object.assign(payload.inputSnapshot.facility, {
    primaryEquipment: options.equipment ?? ["cardio_bike"],
  });
  payload.program.weeks = [{ weekNumber: 1, sessions: [workout] }];
  const saved = vi.fn();
  const form = new FormData();
  if (selected !== undefined) form.set("cardio.modality", selected);
  form.set("cardio.completedMinutes", "30");
  form.set(
    "cardio.completedIntervals",
    String(options.completedIntervals ?? 6),
  );
  form.set("cardio.sessionRpe", "7");
  return {
    saved,
    event: {
      locals: {
        getUser: async () => ({ data: { user: { id: "cardio-user" } } }),
        supabase: {
          from(table: string) {
            if (table === "programs")
              return new FakeQuery({
                data: { id: PROGRAM_ID, name: "Cardio", payload },
                error: null,
              });
            if (table === "workout_logs")
              return new FakeQuery({
                data: options.saved
                  ? { cardio_log: { modality: options.saved } }
                  : null,
                error: null,
              });
            throw new Error(`Unexpected table ${table}`);
          },
          async rpc(name: string, values: unknown) {
            if (name === "workout_session_context")
              return {
                data: {
                  programId: PROGRAM_ID,
                  programVersion: 1,
                  session: workout,
                  effortReporting: "rir",
                  effortFamiliarity: "basic",
                  units: "lb",
                },
                error: null,
              };
            if (name === "save_workout_log_v6") {
              saved(values);
              return { data: { ok: true, updatedAt: NOW }, error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
          },
        },
      },
      params: { id: PROGRAM_ID, sessionId: id },
      request: new Request("https://orbital-training.com/workout", {
        method: "POST",
        body: form,
      }),
    } as never,
  };
}

describe("cardio activity changes", () => {
  it("reloads the saved actual activity and only offers configured alternatives", async () => {
    const payload = draft();
    Object.assign(payload.program.weeks[0]!.sessions[0]!, {
      cardio: { modality: "running", minutes: 30 },
    });
    Object.assign(payload.inputSnapshot.cardio, {
      preferredModalities: ["running", "cycling", "swimming"],
    });
    Object.assign(payload.inputSnapshot.facility, {
      primaryEquipment: ["cardio_bike"],
    });
    const result = await load(
      event(
        "w1",
        [
          {
            ...workoutLog(1),
            status: "in_progress",
            cardio_log: {
              modality: "cycling",
              prescribedModality: "running",
              completedMinutes: 12,
            },
          },
        ],
        [],
        payload,
      ),
    );
    expect(result).toMatchObject({
      session: { cardio: { modality: "running" } },
      existing: {
        cardioLog: {
          modality: "cycling",
          prescribedModality: "running",
          completedMinutes: 12,
        },
      },
      cardioTracking: { availableModalities: ["running", "cycling"] },
    });
  });

  it("saves the actual activity and prescribed activity without changing the program", async () => {
    const test = cardioEvent("cycling");
    const result = await actions.save!(test.event);
    expect(result).toMatchObject({ message: "Workout saved." });
    expect(test.saved).toHaveBeenCalledWith(
      expect.objectContaining({
        p_cardio_log: expect.objectContaining({
          modality: "cycling",
          prescribedModality: "running",
          completedMinutes: 30,
          completedIntervals: 6,
        }),
        p_new_program_payload: null,
      }),
    );
  });

  it("finishes switched cardio with the original time and interval requirements", async () => {
    const test = cardioEvent("cycling");
    await expect(actions.complete!(test.event)).rejects.toMatchObject({
      status: 303,
    });
    expect(test.saved).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "completed",
        p_cardio_log: expect.objectContaining({ modality: "cycling" }),
      }),
    );
  });

  it("does not bypass required intervals when switching", async () => {
    const test = cardioEvent("cycling", { completedIntervals: 2 });
    expect(await actions.complete!(test.event)).toMatchObject({ status: 400 });
    expect(test.saved).not.toHaveBeenCalled();
  });

  it.each(["rowing", "swimming", "forged"])(
    "rejects forged/unavailable %s before saving",
    async (modality) => {
      const test = cardioEvent(modality);
      expect(await actions.save!(test.event)).toMatchObject({ status: 400 });
      expect(test.saved).not.toHaveBeenCalled();
    },
  );

  it("rejects equipment-supported activities that are not among the user's options", async () => {
    const test = cardioEvent("cycling", { preferences: ["running"] });
    expect(await actions.save!(test.event)).toMatchObject({ status: 400 });
    expect(test.saved).not.toHaveBeenCalled();
  });

  it("allows a trusted saved legacy modality to be re-saved without expanding available choices", async () => {
    const test = cardioEvent("swimming", { saved: "swimming" });
    expect(await actions.save!(test.event)).toMatchObject({
      message: "Workout saved.",
    });
    expect(test.saved).toHaveBeenCalledWith(
      expect.objectContaining({
        p_cardio_log: expect.objectContaining({ modality: "swimming" }),
      }),
    );
  });

  it("keeps old clients working when they omit the new modality field", async () => {
    const test = cardioEvent(undefined);
    expect(await actions.save!(test.event)).toMatchObject({
      message: "Workout saved.",
    });
    expect(test.saved).toHaveBeenCalledWith(
      expect.objectContaining({
        p_cardio_log: expect.objectContaining({
          modality: "running",
          prescribedModality: "running",
        }),
      }),
    );
  });

  it("does not relabel a saved alternate when an older client omits modality", async () => {
    const test = cardioEvent(undefined, {
      saved: "swimming",
      preferences: ["running"],
    });
    expect(await actions.save!(test.event)).toMatchObject({
      message: "Workout saved.",
    });
    expect(test.saved).toHaveBeenCalledWith(
      expect.objectContaining({
        p_cardio_log: expect.objectContaining({
          modality: "swimming",
          prescribedModality: "running",
        }),
      }),
    );
  });

  it("finishes an existing alternate from an older client without losing its activity", async () => {
    const test = cardioEvent(undefined, { saved: "cycling" });
    await expect(actions.complete!(test.event)).rejects.toMatchObject({
      status: 303,
    });
    expect(test.saved).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "completed",
        p_cardio_log: expect.objectContaining({ modality: "cycling" }),
      }),
    );
  });

  it("rejects adding cardio modality to a session without prescribed cardio", async () => {
    const test = cardioEvent("cycling", { noCardio: true });
    expect(await actions.save!(test.event)).toMatchObject({ status: 400 });
    expect(test.saved).not.toHaveBeenCalled();
  });
});

describe("permanent substitution provenance", () => {
  it("updates wrapper versions along with the nested program and remains readable", async () => {
    const input = baseInput();
    const program = generateProgram(input).program!;
    const current = program.weeks[0]!.sessions.find((candidate) =>
      candidate.exercises.some((item) => item.alternativeChoices.length > 0),
    )!;
    const prescription = current.exercises.find(
      (item) => item.alternativeChoices.length > 0,
    )!;
    expect(prescription).toBeDefined();
    program.engineVersion = "0.11.0";
    program.policyVersion = "prior-policy";
    const payload = createStoredProgramV3(input, program);
    const before = structuredClone(payload);
    const saved = vi.fn();
    const form = new FormData();
    form.set("submissionMode", "explicit");
    form.set(
      `exercise.${prescription.id}.choice`,
      prescription.alternativeChoices[0]!.exerciseId,
    );
    form.set(`exercise.${prescription.id}.scope`, "permanent");
    const request = {
      locals: {
        getUser: async () => ({ data: { user: { id: "provenance-user" } } }),
        supabase: {
          from(table: string) {
            return new FakeQuery({
              data:
                table === "programs"
                  ? { id: PROGRAM_ID, name: "Prior policy", payload }
                  : null,
              error: null,
            });
          },
          async rpc(name: string, values: unknown) {
            if (name !== "save_workout_log_v6")
              throw new Error(`Unexpected RPC ${name}`);
            saved(values);
            return { data: { ok: true, updatedAt: NOW }, error: null };
          },
        },
      },
      params: { id: PROGRAM_ID, sessionId: current.id },
      request: new Request("https://orbital-training.com/workout", {
        method: "POST",
        body: form,
      }),
    } as never;
    await expect(actions.save!(request)).rejects.toMatchObject({ status: 303 });
    const result = saved.mock.calls[0]![0].p_new_program_payload;
    expect(result).toMatchObject({
      engineVersion: ENGINE_VERSION,
      policyVersion: POLICY_VERSION,
      program: {
        engineVersion: ENGINE_VERSION,
        policyVersion: POLICY_VERSION,
        originEngineVersion: "0.11.0",
        originPolicyVersion: "prior-policy",
      },
    });
    expect(() => parseProgramDraft(result)).not.toThrow();
    expect(payload).toEqual(before);
  });
});
