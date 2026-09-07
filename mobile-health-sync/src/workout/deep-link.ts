export type WorkoutDeepLinkAction =
  | {
      readonly type: "start";
      readonly programId?: string;
      readonly sessionId?: string;
    }
  | { readonly type: "stop" };

export function parseWorkoutDeepLink(
  url: string,
): WorkoutDeepLinkAction | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "orbitalhealth:" || parsed.hostname !== "workout")
      return null;
    const action = parsed.pathname.replace(/^\//, "");
    if (action === "stop") return { type: "stop" };
    // The web app uses orbitalhealth://workout?... (empty path); retain
    // /start for compatibility with manually constructed links.
    if (action !== "" && action !== "start") return null;
    const programId = parsed.searchParams.get("programId")?.trim();
    const sessionId = parsed.searchParams.get("sessionId")?.trim();
    return {
      type: "start",
      ...(programId ? { programId } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
  } catch {
    return null;
  }
}
