import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/** The brand "skin" — an accent/surface hue, independent of light/dark.
 *  `deepsea` is the original electric-cyan look; the others are warmer,
 *  more game-night palettes. Applied as a `.brand-*` class on <html>. */
export type Brand = "arcade" | "blurple" | "sunset" | "deepsea";

const THEME_KEY = "theme";
const BRAND_KEY = "brand";
const DEFAULT_THEME: Theme = "dark";
const DEFAULT_BRAND: Brand = "arcade";

const BRAND_IDS: Brand[] = ["arcade", "blurple", "sunset", "deepsea"];

/** Picker metadata: label + a swatch gradient (the dark brand gradient). */
export const BRANDS: { id: Brand; label: string; swatch: string }[] = [
  {
    id: "arcade",
    label: "Neon Arcade",
    swatch: "linear-gradient(135deg, #a855f7, #e879f9)",
  },
  {
    id: "blurple",
    label: "Blurple",
    swatch: "linear-gradient(135deg, #6366f1, #a5b4fc)",
  },
  {
    id: "sunset",
    label: "Party Sunset",
    swatch: "linear-gradient(135deg, #fb923c, #d946ef)",
  },
  {
    id: "deepsea",
    label: "Deep Sea",
    swatch: "linear-gradient(135deg, #22d3ee, #0e7490)",
  },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

function applyBrand(brand: Brand) {
  const root = document.documentElement;
  for (const b of BRAND_IDS) root.classList.remove(`brand-${b}`);
  root.classList.add(`brand-${brand}`);
}

export function getTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return DEFAULT_THEME;
}

export function getBrand(): Brand {
  if (typeof window === "undefined") return DEFAULT_BRAND;
  const stored = window.localStorage.getItem(BRAND_KEY);
  if (stored && (BRAND_IDS as string[]).includes(stored)) return stored as Brand;
  return DEFAULT_BRAND;
}

export function setTheme(theme: Theme) {
  window.localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
  window.dispatchEvent(new Event("themechange"));
}

export function setBrand(brand: Brand) {
  window.localStorage.setItem(BRAND_KEY, brand);
  applyBrand(brand);
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

export function useBrand(): Brand {
  return useSyncExternalStore(
    subscribe,
    () => getBrand(),
    () => DEFAULT_BRAND,
  );
}

/** Inline <script> for the document head: applies the stored theme + brand
 *  before first paint so there's no flash of the wrong palette. */
export const themeInitScript = `(function(){try{var r=document.documentElement;var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t='${DEFAULT_THEME}';r.classList.remove('light','dark');r.classList.add(t);var bs=['arcade','blurple','sunset','deepsea'];var b=localStorage.getItem('${BRAND_KEY}');if(bs.indexOf(b)===-1)b='${DEFAULT_BRAND}';for(var i=0;i<bs.length;i++)r.classList.remove('brand-'+bs[i]);r.classList.add('brand-'+b);}catch(e){}})();`;
