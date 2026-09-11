// Language section of the Advance Paseo settings screen. Changing the
// preference swaps every feature's dictionary live.

import { useMemo } from "react";
import { Text } from "react-native";
import {
  useSettings,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { languageSettings } from "../../shared/i18n";
import { SETTINGS_CARD_TEST_ID } from "../wallpaper/wallpaper-css";
import { format } from "./dictionaries";
import {
  applyPreferredLanguage,
  getEffectiveLanguage,
  useText,
} from "./store";

export function LanguageSettingsSection({ theme }: PluginSurfaceProps) {
  const settings = useSettings(languageSettings);
  const t = useText();

  const mutedStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  const dangerStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);

  const languageOptions = [
    { label: t.language.auto, value: "auto" as const },
    { label: t.language.english, value: "en" as const },
    { label: t.language.chinese, value: "zh" as const },
  ];

  if (settings.status === "loading") {
    return (
      <SettingsSection title={t.language.sectionTitle}>
        <Text style={mutedStyle}>{t.language.loading}</Text>
      </SettingsSection>
    );
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title={t.language.sectionTitle}>
        <Text style={dangerStyle}>{settings.error}</Text>
      </SettingsSection>
    );
  }

  const effectiveName =
    getEffectiveLanguage() === "zh" ? t.language.chinese : t.language.english;

  return (
    <SettingsSection
      title={t.language.sectionTitle}
      info={<Text style={mutedStyle}>{t.language.sectionInfo}</Text>}
    >
      <SettingsCard testID={SETTINGS_CARD_TEST_ID}>
        <SettingsSelect
          label={t.language.languageLabel}
          hint={
            settings.values.language === "auto"
              ? `${t.language.languageHint} · ${format(t.language.effective, { language: effectiveName })}`
              : t.language.languageHint
          }
          value={settings.values.language}
          options={languageOptions}
          disabled={settings.saving}
          onValueChange={(value) => {
            // Instant local swap; persistence follows.
            applyPreferredLanguage(value);
            void settings
              .save({ ...settings.values, language: value }, settings.revision)
              .then((saved) => {
                if (!saved) {
                  // Revert the optimistic swap to the persisted value.
                  applyPreferredLanguage(settings.values.language);
                  void settings.reload();
                }
              });
          }}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
