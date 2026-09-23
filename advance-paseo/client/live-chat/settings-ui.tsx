// Live-chat section of the Advance Paseo settings screen: the floating TODO
// card (with the current plan/goal) and the tokens/sec meter. Edits persist
// through the host-scoped settings document and reach the engine immediately
// for live feedback. All visible text comes from the i18n dictionary.

import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import {
  useSettings,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { SETTINGS_CARD_TEST_ID } from "../wallpaper/wallpaper-css";
import { SliderRow } from "../ui/slider-row";
import { useText } from "../i18n/store";
import { format } from "../i18n/dictionaries";
import {
  CHAT_SHIFT_PRESETS,
  CHAT_SHIFT_RANGE,
  MAX_TODO_CHOICES,
  liveChatSettings,
  type LiveChatSettings,
} from "../../shared/live-chat";
import { applyLiveChatState, engineStateOf } from "./engine";

export function LiveChatSettingsSection({ theme }: PluginSurfaceProps) {
  const settings = useSettings(liveChatSettings);
  const t = useText();
  const valuesKey = settings.status === "ready" ? JSON.stringify(settings.values) : "";
  useEffect(() => {
    if (settings.status === "ready") applyLiveChatState(engineStateOf(settings.values));
  }, [settings.status, valuesKey]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Shift value while dragging; null when showing the persisted value. */
  const [shiftDraft, setShiftDraft] = useState<number | null>(null);

  const mutedStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  const dangerStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);

  const maxItemOptions = useMemo(
    () =>
      MAX_TODO_CHOICES.map((value) => ({
        label: t.liveChat.maxItemsOption.replace("{count}", String(value)),
        value: String(value),
      })),
    [t],
  );

  const shiftPresets = useMemo(
    () =>
      CHAT_SHIFT_PRESETS.map((preset) => ({
        label: t.liveChat.shiftPresetLabels[preset.id] ?? String(preset.value),
        value: preset.value,
      })),
    [t],
  );

  if (settings.status === "loading") {
    return (
      <SettingsSection title={t.liveChat.sectionTitle}>
        <Text style={mutedStyle}>{t.liveChat.loading}</Text>
      </SettingsSection>
    );
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title={t.liveChat.sectionTitle}>
        <Text style={dangerStyle}>{settings.error}</Text>
        <SettingsAction
          label={t.common.couldNotRead}
          actionLabel={t.common.retry}
          onPress={() => void settings.reload()}
        />
        {settings.status === "invalid" ? (
          <SettingsAction
            label={t.common.storedInvalid}
            actionLabel={t.common.restoreDefaults}
            onPress={() => void settings.reset()}
          />
        ) : null}
      </SettingsSection>
    );
  }

  const values = settings.values;

  /** Apply + persist a full settings object. */
  const commit = async (next: LiveChatSettings): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      applyLiveChatState(engineStateOf(next));
      const saved = await settings.save(next, settings.revision);
      if (!saved) void settings.reload();
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : String(commitError));
    } finally {
      setBusy(false);
    }
  };

  const change = <Key extends keyof LiveChatSettings>(
    key: Key,
    value: LiveChatSettings[Key],
  ) => {
    void commit({ ...values, [key]: value });
  };

  return (
    <SettingsSection
      title={t.liveChat.sectionTitle}
      info={<Text style={mutedStyle}>{t.liveChat.sectionInfo}</Text>}
    >
      <SettingsCard testID={SETTINGS_CARD_TEST_ID}>
        <SettingsSwitch
          label={t.liveChat.todoCardLabel}
          hint={t.liveChat.todoCardHint}
          value={values.todoCardEnabled}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("todoCardEnabled", value)}
        />
        <SettingsSwitch
          label={t.liveChat.goalLabel}
          hint={t.liveChat.goalHint}
          value={values.showGoal}
          disabled={busy || settings.saving || !values.todoCardEnabled}
          onValueChange={(value) => change("showGoal", value)}
        />
        <SettingsSelect
          label={t.liveChat.maxItemsLabel}
          hint={t.liveChat.maxItemsHint}
          value={String(values.maxTodoItems)}
          options={maxItemOptions}
          disabled={busy || settings.saving || !values.todoCardEnabled}
          onValueChange={(value) => change("maxTodoItems", Number(value))}
        />
        <SliderRow
          theme={theme}
          label={t.liveChat.shiftLabel}
          hint={t.liveChat.shiftHint}
          value={shiftDraft ?? values.chatShift}
          min={CHAT_SHIFT_RANGE.min}
          max={CHAT_SHIFT_RANGE.max}
          step={CHAT_SHIFT_RANGE.step}
          formatValue={(value) => format(t.liveChat.shiftValue, { value: String(value) })}
          presets={shiftPresets}
          accessibilityLabel={t.liveChat.shiftLabel}
          decreaseLabel={format(t.common.decrease, { label: t.liveChat.shiftLabel })}
          increaseLabel={format(t.common.increase, { label: t.liveChat.shiftLabel })}
          disabled={busy || settings.saving || !values.todoCardEnabled}
          onValueChange={setShiftDraft}
          onRelease={(value) => {
            setShiftDraft(null);
            void commit({ ...values, chatShift: value });
          }}
        />
      </SettingsCard>

      <SettingsCard testID={SETTINGS_CARD_TEST_ID}>
        <SettingsSwitch
          label={t.liveChat.meterLabel}
          hint={t.liveChat.meterHint}
          value={values.rateMeterEnabled}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("rateMeterEnabled", value)}
        />
        <SettingsRow label={t.liveChat.meterShowsLabel} hint={t.liveChat.meterShowsHint} />
      </SettingsCard>

      <Text style={[mutedStyle, { fontSize: 12 }]}>{t.liveChat.webOnlyNote}</Text>

      {settings.saveError ? (
        <Text accessibilityRole="alert" style={dangerStyle}>
          {settings.saveError}
        </Text>
      ) : null}
      {error !== null ? (
        <Text accessibilityRole="alert" style={dangerStyle}>
          {error}
        </Text>
      ) : null}
    </SettingsSection>
  );
}
