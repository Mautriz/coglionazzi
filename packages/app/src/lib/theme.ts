import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const DEFAULT_THEME: Theme = "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

export function getTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return DEFAULT_THEME;
}

export function setTheme(theme: Theme) {
  window.localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  window.dispatchEvent(new Event("themechange"));
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

function subscribe(cb: () => void) {
  window.addEventListener("themechange", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("themechange", cb);
    window.removeEventListener("storage", cb);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => getTheme(),
    () => DEFAULT_THEME,
  );
}

/** Inline <script> for the document head: applies the stored theme before
 *  first paint so there's no flash of the wrong theme. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark')t='${DEFAULT_THEME}';var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);}catch(e){}})();`;
