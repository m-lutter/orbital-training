export const PROGRAM_OVERVIEW_VISITS_COOKIE = "orbital_program_overviews_seen";
export const PROGRAM_OVERVIEW_VISITS_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const MAX_TRACKED_PROGRAMS = 64;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function viewedProgramIds(value: string | undefined): string[] {
  const unique = new Set(
    (value ?? "")
      .split(".")
      .filter((candidate) => UUID_PATTERN.test(candidate)),
  );
  return [...unique].slice(-MAX_TRACKED_PROGRAMS);
}

export function programOverviewVisit(
  cookieValue: string | undefined,
  programId: string,
): { cookieValue: string; firstVisit: boolean } {
  const viewed = viewedProgramIds(cookieValue);
  const firstVisit = !viewed.includes(programId);
  const next = firstVisit ? [...viewed, programId] : viewed;
  return {
    cookieValue: next.slice(-MAX_TRACKED_PROGRAMS).join("."),
    firstVisit,
  };
}
