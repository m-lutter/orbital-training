export const APP_THEME_STORAGE_KEY = "powerlifting-app-theme";
export const APP_THEME_COOKIE = "app_theme";

export type AppTheme = "orbital" | "cute";

export function parseAppTheme(value: unknown): AppTheme | undefined {
  return value === "orbital" || value === "cute" ? value : undefined;
}

export function themeCookie(theme: AppTheme, secure: boolean): string {
  return `${APP_THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
