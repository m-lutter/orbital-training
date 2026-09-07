const COOKIE_NAME = "recent_program_id";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProgramCookieStore {
  get(name: string): string | undefined;
  set(
    name: string,
    value: string,
    options: {
      path: string;
      httpOnly: boolean;
      sameSite: "lax";
      secure: boolean;
      maxAge: number;
    },
  ): void;
}

export function recentProgramId(
  cookies: ProgramCookieStore,
): string | undefined {
  const value = cookies.get(COOKIE_NAME);
  return value !== undefined && UUID_PATTERN.test(value) ? value : undefined;
}

export function rememberRecentProgram(
  cookies: ProgramCookieStore,
  programId: string,
  secure: boolean,
): void {
  if (!UUID_PATTERN.test(programId)) return;
  cookies.set(COOKIE_NAME, programId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 60 * 60 * 24 * 365,
  });
}
