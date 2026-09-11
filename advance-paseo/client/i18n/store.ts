// Client-side language store. The effective language resolves synchronously
// at first import (Auto = detected locale, with English as fallback), so
// components render correctly on first paint; an explicitly persisted
// preference arrives asynchronously through the i18n contribution and swaps
// the dictionary in place.

import { useEffect, useState } from "react";
import { NativeModules, Platform } from "react-native";
import type { LanguagePreference, PluginLanguage } from "../../shared/i18n";
import { detectWebLanguage } from "../web";
import { dictionaries, type Dictionary } from "./dictionaries";

/** RN's I18nManager typing dropped localeIdentifier; read it untyped. */
function detectNativeLanguage(): PluginLanguage | null {
  const modules = NativeModules as {
    I18nManager?: { localeIdentifier?: string };
    SettingsManager?: {
      settings?: { AppleLocale?: string; AppleLanguages?: string[] };
    };
  };
  const locale =
    modules.I18nManager?.localeIdentifier ??
    modules.SettingsManager?.settings?.AppleLocale ??
    modules.SettingsManager?.settings?.AppleLanguages?.[0];
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh") ? "zh" : null;
}

/** Detect the host locale: web reads the browser, native reads RN modules. */
function detectLanguage(): PluginLanguage | null {
  if (Platform.OS === "web") return detectWebLanguage();
  return detectNativeLanguage();
}

function resolve(preferred: LanguagePreference): PluginLanguage {
  if (preferred !== "auto") return preferred;
  return detectLanguage() ?? "en";
}

let preferred: LanguagePreference = "auto";
let effective: PluginLanguage = resolve(preferred);

const listeners = new Set<(text: Dictionary) => void>();

/** The dictionary for the current effective language. */
export function getText(): Dictionary {
  return dictionaries[effective];
}

/** The persisted preference ("auto" until the settings RPC lands). */
export function getPreferredLanguage(): LanguagePreference {
  return preferred;
}

/** The language actually being rendered. */
export function getEffectiveLanguage(): PluginLanguage {
  return effective;
}

/** Apply a (new) persisted preference; notifies subscribers on change. */
export function applyPreferredLanguage(next: LanguagePreference): void {
  preferred = next;
  const resolved = resolve(next);
  if (resolved === effective) return;
  effective = resolved;
  for (const listener of listeners) listener(getText());
}

/** Subscribe to dictionary swaps; returns an idempotent unsubscribe. */
export function subscribeText(listener: (text: Dictionary) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook over the current dictionary. */
export function useText(): Dictionary {
  const [text, setText] = useState<Dictionary>(getText);
  useEffect(() => subscribeText(setText), []);
  return text;
}
