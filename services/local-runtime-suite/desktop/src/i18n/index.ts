import { useCallback, useEffect, useMemo, useState } from "react";
import { en } from "./en";
import { fr } from "./fr";

export type Locale = "en" | "fr";
export type ResourceTree = { readonly [key: string]: string | ResourceTree };
export type InterpolationValues = Record<string, string | number>;
export type Translator = (key: string, values?: InterpolationValues) => string;

export const LOCALE_STORAGE_KEY = "therapy-local-runtime.locale";
export const resources: Record<Locale, ResourceTree> = { en, fr };

export function resolveInitialLocale(
  storage: Pick<Storage, "getItem"> | undefined,
  browserLanguages: readonly string[]
): Locale {
  let stored: string | null | undefined;
  try {
    stored = storage?.getItem(LOCALE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === "en" || stored === "fr") return stored;
  return browserLanguages.some((language) => language.toLowerCase().startsWith("fr"))
    ? "fr"
    : "en";
}

export function translate(
  locale: Locale,
  key: string,
  values: InterpolationValues = {}
): string {
  const value = key.split(".").reduce<string | ResourceTree | undefined>(
    (node, segment) =>
      typeof node === "object" && node !== null ? node[segment] : undefined,
    resources[locale]
  );
  if (typeof value !== "string") {
    throw new Error(`Missing ${locale} desktop translation: ${key}`);
  }
  const translated = value.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
  );
  const unresolved = translated.match(/\{([A-Za-z0-9_]+)\}/);
  if (unresolved) {
    throw new Error(
      `Missing interpolation value ${unresolved[1]} for ${locale} desktop translation: ${key}`
    );
  }
  return translated;
}

export function flattenResourceKeys(
  resource: ResourceTree,
  prefix = ""
): string[] {
  return Object.entries(resource).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flattenResourceKeys(value, path);
  });
}

export function flattenResourceValues(
  resource: ResourceTree,
  prefix = ""
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(resource).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "string"
        ? [[path, value]]
        : Object.entries(flattenResourceValues(value, path));
    })
  );
}

export function useDesktopLocale() {
  const [locale, setLocale] = useState<Locale>(() =>
    resolveInitialLocale(
      typeof window === "undefined" ? undefined : window.localStorage,
      typeof navigator === "undefined" ? [] : navigator.languages
    )
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // The locale still works for this session when storage is unavailable.
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: string, values?: InterpolationValues) => translate(locale, key, values),
    [locale]
  );

  return useMemo(() => ({ locale, setLocale, t }), [locale, t]);
}
