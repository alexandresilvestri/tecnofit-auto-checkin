type Theme = "dark" | "light";

const storage = (fn: () => string | null | void) => { try { return fn(); } catch { return null; } };

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = t === "light" ? "#ffffff" : "#000000";
  return t;
}

export function setTheme(t: Theme) {
  storage(() => localStorage.setItem("theme", t));
  return applyTheme(t);
}

export const currentTheme = () => document.documentElement.dataset.theme as Theme;

const stored = storage(() => localStorage.getItem("theme"));
applyTheme(stored === "light" || stored === "dark" ? stored : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
