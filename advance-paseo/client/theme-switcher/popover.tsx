// Popover behind the workspace header's theme-switcher button. Lists the
// built-in Paseo themes and this plugin's contributed themes; picking one
// routes through the host's app-settings pipeline (see app-theme.ts) so the
// change applies immediately and survives restarts. Built from React Native
// core primitives like every other plugin surface.

import { useCallback, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useText } from "../i18n/store";
import {
  applyAppThemePreference,
  readAppThemePreference,
} from "./app-theme";
import {
  BUILTIN_THEME_OPTIONS,
  isActiveBuiltin,
  isActivePluginTheme,
  PLUGIN_THEME_OPTIONS,
  type BuiltinThemeOption,
  type PluginThemeOption,
} from "./catalog";

const POPOVER_WIDTH = 264;
const ROW_HEIGHT = 36;
const SWATCH_SIZE = 18;
const DOT_SIZE = 8;
const SECTION_GAP = 8;

interface RowProps {
  readonly label: string;
  readonly swatch: string;
  readonly active: boolean;
  readonly borderColor: string;
  readonly foreground: string;
  readonly accent: string;
  readonly onPress: () => void;
}

function ThemeRow({
  label,
  swatch,
  active,
  borderColor,
  foreground,
  accent,
  onPress,
}: RowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: ROW_HEIGHT,
        paddingHorizontal: 8,
        borderRadius: 8,
        gap: 10,
      }}
    >
      <View
        style={{
          width: SWATCH_SIZE,
          height: SWATCH_SIZE,
          borderRadius: SWATCH_SIZE / 2,
          backgroundColor: swatch,
          borderWidth: 1,
          borderColor,
        }}
      />
      <Text style={{ color: foreground, fontSize: 14, flex: 1 }}>{label}</Text>
      {/* Active marker: a small accent dot, drawn with Views so it centers
       * exactly on the row like the slider glyphs. */}
      <View
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: active ? accent : "transparent",
        }}
      />
    </Pressable>
  );
}

interface SectionProps {
  readonly title: string;
  readonly muted: string;
  readonly children: ReactNode;
}

function ThemeSection({ title, muted, children }: SectionProps) {
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <Text
        style={{
          fontSize: 12,
          color: muted,
          paddingHorizontal: 8,
          paddingVertical: 4,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function ThemeSwitcherPopover(props: PluginButtonContentProps) {
  const { theme, layout, close } = props;
  const t = useText();
  // Re-read on every mount so a freshly opened popover reflects the current
  // preference even if it changed through the app's own appearance settings.
  const [preference, setPreference] = useState(() => readAppThemePreference());
  const [failed, setFailed] = useState(false);

  const selectBuiltin = useCallback(
    (option: BuiltinThemeOption) => {
      const next = { theme: option.preference, pluginThemeId: null };
      // Appearance only matters for plugin themes; built-ins ignore it.
      if (!applyAppThemePreference(next, "light")) {
        setFailed(true);
        return;
      }
      setPreference(next);
      close();
    },
    [close],
  );

  const selectPluginTheme = useCallback(
    (option: PluginThemeOption) => {
      const next = { theme: option.preference, pluginThemeId: option.pluginThemeId };
      if (!applyAppThemePreference(next, option.appearance)) {
        setFailed(true);
        return;
      }
      setPreference(next);
      close();
    },
    [close],
  );

  if (layout.platform !== "web") {
    return (
      <View style={{ width: POPOVER_WIDTH, padding: 12 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
          {t.themeSwitcher.nativeFallback}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width: POPOVER_WIDTH, padding: 4, paddingBottom: 8 }}>
      <ThemeSection title={t.themeSwitcher.systemGroup} muted={theme.colors.foregroundMuted}>
        {BUILTIN_THEME_OPTIONS.map((option) => (
          <ThemeRow
            key={option.preference}
            label={t.themeSwitcher.themeNameLabels[option.preference] ?? option.preference}
            swatch={option.swatch}
            active={isActiveBuiltin(option, preference)}
            borderColor={theme.colors.border}
            foreground={theme.colors.foreground}
            accent={theme.colors.accent}
            onPress={() => selectBuiltin(option)}
          />
        ))}
      </ThemeSection>
      <ThemeSection title={t.themeSwitcher.customGroup} muted={theme.colors.foregroundMuted}>
        {PLUGIN_THEME_OPTIONS.map((option) => (
          <ThemeRow
            key={option.pluginThemeId}
            label={option.name}
            swatch={option.swatch}
            active={isActivePluginTheme(option, preference)}
            borderColor={theme.colors.border}
            foreground={theme.colors.foreground}
            accent={theme.colors.accent}
            onPress={() => selectPluginTheme(option)}
          />
        ))}
      </ThemeSection>
      {failed ? (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.statusDanger, fontSize: 12, paddingHorizontal: 8, marginTop: 4 }}
        >
          {t.themeSwitcher.failed}
        </Text>
      ) : null}
    </View>
  );
}
