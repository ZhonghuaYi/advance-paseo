// Wallpaper section of the Advance Paseo settings screen. Edits persist
// through the host-scoped settings document and reach the wallpaper engine
// immediately for live feedback. All visible text comes from the i18n
// dictionary.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { isWebPlatform, pickWallpaperImage } from "../web";
import { useText } from "../i18n/store";
import { format as formatTemplate } from "../i18n/dictionaries";
import { SliderRow } from "../ui/slider-row";
import { SETTINGS_CARD_TEST_ID } from "./wallpaper-css";
import {
  applyWallpaperState,
  engineStateOf,
  setWallpaperImages,
  type WallpaperImages,
} from "./engine";
import { resolveWallpaperImagesWith, type WallpaperReader } from "./loader";
import { ACCENT_VALUES } from "./palettes";
import {
  BLUR_PRESETS,
  BLUR_RANGE,
  SCRIM_PRESETS,
  SCRIM_RANGE,
  wallpaperDeleteRpc,
  wallpaperListRpc,
  wallpaperReadPathRpc,
  wallpaperReadRpc,
  wallpaperSettings,
  wallpaperUploadRpc,
  type WallpaperMeta,
  type WallpaperSettings,
  type WallpaperSource,
} from "../../shared/wallpaper";

type WallpaperSlot = "light" | "dark";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

export function WallpaperSettingsSection({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(wallpaperSettings);
  const t = useText();
  const listRpc = useRpc(wallpaperListRpc);
  const uploadRpc = useRpc(wallpaperUploadRpc);
  const deleteRpc = useRpc(wallpaperDeleteRpc);
  const readRpc = useRpc(wallpaperReadRpc);
  const readPathRpc = useRpc(wallpaperReadPathRpc);

  const [library, setLibrary] = useState<readonly WallpaperMeta[]>([]);
  const [previews, setPreviews] = useState<WallpaperImages>({ light: null, dark: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathDrafts, setPathDrafts] = useState<Record<WallpaperSlot, string>>({
    light: "",
    dark: "",
  });
  /** Slider values while dragging; null when showing the persisted value. */
  const [scrimDraft, setScrimDraft] = useState<number | null>(null);
  const [blurDraft, setBlurDraft] = useState<number | null>(null);

  const mutedStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  const dangerStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);
  const linkStyle = useMemo(
    () => ({ color: theme.colors.accent, fontSize: layout.compact ? 13 : 14 }),
    [theme, layout.compact],
  );

  const accentOptions = useMemo(
    () => ACCENT_VALUES.map((value) => ({ label: t.wallpaper.accentLabels[value], value })),
    [t],
  );
  const modeOptions = useMemo(
    () => [
      { label: t.wallpaper.modeSystem, value: "system" as const },
      { label: t.wallpaper.modeAll, value: "all" as const },
    ],
    [t],
  );
  const scrimPresets = useMemo(
    () => SCRIM_PRESETS.map((preset) => ({ label: t.wallpaper.scrimPresetLabels[preset.id], value: preset.value })),
    [t],
  );
  const blurPresets = useMemo(
    () => BLUR_PRESETS.map((preset) => ({ label: t.wallpaper.blurPresetLabels[preset.id], value: preset.value })),
    [t],
  );

  const reader = useMemo<WallpaperReader>(
    () => ({
      readManaged: (id) => readRpc({ id }).then((result) => result.dataUrl),
      readPath: (path) => readPathRpc({ path }).then((result) => result.dataUrl),
    }),
    [readRpc, readPathRpc],
  );

  const valuesKey =
    settings.status === "ready" ? JSON.stringify(settings.values) : "";
  const slotsKey =
    settings.status === "ready"
      ? JSON.stringify([settings.values.light, settings.values.dark])
      : "";

  const refreshLibrary = useCallback(async () => {
    try {
      const result = await listRpc({});
      setLibrary(result.items);
    } catch (listError) {
      console.error("[advance-paseo] wallpaper list failed", listError);
    }
  }, [listRpc]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  // Apply persisted values as soon as they arrive; this also covers hosts
  // where the entry-time RPC read could not run.
  useEffect(() => {
    if (settings.status === "ready") applyWallpaperState(engineStateOf(settings.values));
  }, [valuesKey, settings.status]); // valuesKey captures the values

  // Preview images reload only when the picked slots change, not on style
  // tweaks, to avoid re-transferring megabytes on every switch flip.
  useEffect(() => {
    if (settings.status !== "ready") return;
    void resolveWallpaperImagesWith(reader, settings.values)
      .then(setPreviews)
      .catch(() => setPreviews({ light: null, dark: null }));
  }, [slotsKey, settings.status, reader]); // eslint-disable-line react-hooks/exhaustive-deps

  if (settings.status === "loading") {
    return (
      <SettingsSection title={t.wallpaper.sectionTitle}>
        <Text style={mutedStyle}>{t.wallpaper.loading}</Text>
      </SettingsSection>
    );
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title={t.wallpaper.sectionTitle}>
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

  const describeSource = (source: WallpaperSource | null): string => {
    if (source === null) return t.wallpaper.none;
    if (source.kind === "path") return source.path;
    const meta = library.find((item) => item.id === source.id);
    return meta !== undefined
      ? meta.name
      : formatTemplate(t.wallpaper.importedLabel, { id: source.id.slice(0, 8) });
  };

  /** Apply + persist a full settings object, resolving slot images eagerly. */
  const commit = async (next: WallpaperSettings): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      applyWallpaperState(engineStateOf(next));
      const images = await resolveWallpaperImagesWith(reader, next);
      setWallpaperImages(images);
      setPreviews(images);
      const saved = await settings.save(next, settings.revision);
      if (!saved) void settings.reload();
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : String(commitError));
    } finally {
      setBusy(false);
    }
  };

  const change = <Key extends keyof WallpaperSettings>(
    key: Key,
    value: WallpaperSettings[Key],
  ) => {
    void commit({ ...values, [key]: value });
  };

  const importIntoSlot = async (slot: WallpaperSlot): Promise<void> => {
    const picked = await pickWallpaperImage();
    if (picked === null) {
      if (!isWebPlatform()) setError(t.wallpaper.importNeedsWeb);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const upload = await uploadRpc({ name: picked.name, dataUrl: picked.dataUrl });
      await refreshLibrary();
      await commit({ ...values, [slot]: { kind: "managed", id: upload.wallpaper.id } });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setBusy(false);
    }
  };

  const importToLibrary = async (): Promise<void> => {
    const picked = await pickWallpaperImage();
    if (picked === null) {
      if (!isWebPlatform()) setError(t.wallpaper.importNeedsWeb);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadRpc({ name: picked.name, dataUrl: picked.dataUrl });
      await refreshLibrary();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setBusy(false);
    }
  };

  const applyPath = async (slot: WallpaperSlot): Promise<void> => {
    const path = pathDrafts[slot].trim();
    if (path.length === 0) return;
    await commit({ ...values, [slot]: { kind: "path", path } });
    setPathDrafts((drafts) => ({ ...drafts, [slot]: "" }));
  };

  const clearSlot = async (slot: WallpaperSlot): Promise<void> => {
    await commit({ ...values, [slot]: null });
  };

  const useFor = async (slot: WallpaperSlot, item: WallpaperMeta): Promise<void> => {
    await commit({ ...values, [slot]: { kind: "managed", id: item.id } });
  };

  const removeItem = async (item: WallpaperMeta): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Clear any slot that referenced the item so reads never fail.
      const next: WallpaperSettings = { ...values };
      if (next.light?.kind === "managed" && next.light.id === item.id) next.light = null;
      if (next.dark?.kind === "managed" && next.dark.id === item.id) next.dark = null;
      if (next.light !== values.light || next.dark !== values.dark) {
        await commit(next);
      }
      await deleteRpc({ id: item.id });
      await refreshLibrary();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusy(false);
    }
  };

  const libraryHint =
    library.length === 1
      ? t.wallpaper.imagesStoredOne
      : formatTemplate(t.wallpaper.imagesStoredMany, { count: library.length });

  return (
    <SettingsSection
      title={t.wallpaper.sectionTitle}
      info={<Text style={mutedStyle}>{t.wallpaper.sectionInfo}</Text>}
    >
      <SettingsCard testID={SETTINGS_CARD_TEST_ID}>
        <SettingsSwitch
          label={t.wallpaper.masterLabel}
          hint={t.wallpaper.masterHint}
          value={values.enabled}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("enabled", value)}
        />
        <SettingsSelect
          label={t.wallpaper.activeWhenLabel}
          hint={
            values.mode === "system"
              ? t.wallpaper.activeWhenSystemHint
              : t.wallpaper.activeWhenAllHint
          }
          value={values.mode}
          options={modeOptions}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("mode", value)}
        />
        <SliderRow
          theme={theme}
          label={t.wallpaper.scrimLabel}
          hint={t.wallpaper.scrimHint}
          value={scrimDraft ?? values.scrim}
          min={SCRIM_RANGE.min}
          max={SCRIM_RANGE.max}
          step={SCRIM_RANGE.step}
          formatValue={(value) => `${value}%`}
          presets={scrimPresets}
          accessibilityLabel={t.wallpaper.scrimLabel}
          decreaseLabel={formatTemplate(t.common.decrease, { label: t.wallpaper.scrimLabel })}
          increaseLabel={formatTemplate(t.common.increase, { label: t.wallpaper.scrimLabel })}
          disabled={busy || settings.saving}
          onValueChange={(next) => {
            // Live preview: rebuild the stylesheet while dragging; the
            // document is only written when the slider settles.
            setScrimDraft(next);
            applyWallpaperState({ ...engineStateOf(values), scrim: next });
          }}
          onRelease={(next) => {
            setScrimDraft(null);
            void commit({ ...values, scrim: next });
          }}
        />
        <SliderRow
          theme={theme}
          label={t.wallpaper.glassBlurLabel}
          hint={t.wallpaper.blurHint}
          value={blurDraft ?? values.blur}
          min={BLUR_RANGE.min}
          max={BLUR_RANGE.max}
          step={BLUR_RANGE.step}
          formatValue={(value) => `${value} px`}
          presets={blurPresets}
          accessibilityLabel={t.wallpaper.glassBlurLabel}
          decreaseLabel={formatTemplate(t.common.decrease, { label: t.wallpaper.glassBlurLabel })}
          increaseLabel={formatTemplate(t.common.increase, { label: t.wallpaper.glassBlurLabel })}
          disabled={busy || settings.saving}
          onValueChange={(next) => {
            setBlurDraft(next);
            applyWallpaperState({ ...engineStateOf(values), blur: next });
          }}
          onRelease={(next) => {
            setBlurDraft(null);
            void commit({ ...values, blur: next });
          }}
        />
        <SettingsSelect
          label={t.wallpaper.messageAccentLabel}
          value={values.accent}
          options={accentOptions}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("accent", value)}
        />
      </SettingsCard>

      {(["light", "dark"] as const).map((slot) => (
        <SettingsCard key={slot} testID={SETTINGS_CARD_TEST_ID}>
          <SettingsRow
            label={slot === "light" ? t.wallpaper.lightSlot : t.wallpaper.darkSlot}
            hint={describeSource(values[slot])}
          >
            {previews[slot] !== null ? (
              <Image
                source={{ uri: previews[slot] ?? undefined }}
                style={{
                  width: 96,
                  height: 54,
                  borderRadius: 8,
                  marginLeft: layout.compact ? 8 : 12,
                }}
                resizeMode="cover"
                accessibilityLabel={
                  slot === "light" ? t.wallpaper.lightPreviewAlt : t.wallpaper.darkPreviewAlt
                }
              />
            ) : null}
          </SettingsRow>
          <SettingsAction
            label={t.wallpaper.importLabel}
            hint={t.wallpaper.importHint}
            actionLabel={t.wallpaper.chooseFile}
            disabled={busy || settings.saving}
            onPress={() => void importIntoSlot(slot)}
          />
          <SettingsInput
            label={t.wallpaper.pathLabel}
            hint={t.wallpaper.pathHint}
            placeholder={t.wallpaper.pathPlaceholder}
            initialValue={pathDrafts[slot]}
            onChangeText={(text) =>
              setPathDrafts((drafts) => ({ ...drafts, [slot]: text }))
            }
            disabled={busy || settings.saving}
          />
          <SettingsAction
            label={t.wallpaper.applyPathLabel}
            actionLabel={t.wallpaper.apply}
            disabled={busy || settings.saving || pathDrafts[slot].trim().length === 0}
            onPress={() => void applyPath(slot)}
          />
          {values[slot] !== null ? (
            <SettingsAction
              label={t.wallpaper.clearSlotLabel}
              actionLabel={t.wallpaper.clear}
              disabled={busy || settings.saving}
              onPress={() => void clearSlot(slot)}
            />
          ) : null}
        </SettingsCard>
      ))}

      <SettingsCard testID={SETTINGS_CARD_TEST_ID}>
        <SettingsAction
          label={t.wallpaper.importLibraryLabel}
          hint={libraryHint}
          actionLabel={t.wallpaper.chooseFile}
          disabled={busy || settings.saving}
          onPress={() => void importToLibrary()}
        />
        {library.map((item) => (
          <SettingsRow
            key={item.id}
            label={item.name}
            hint={`${formatBytes(item.bytes)} · ${new Date(item.addedAt).toLocaleDateString()}`}
          >
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={formatTemplate(t.wallpaper.useForLightAlt, { name: item.name })}
                onPress={() => void useFor("light", item)}
              >
                <Text style={linkStyle}>{t.wallpaper.useLight}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={formatTemplate(t.wallpaper.useForDarkAlt, { name: item.name })}
                onPress={() => void useFor("dark", item)}
              >
                <Text style={linkStyle}>{t.wallpaper.useDark}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={formatTemplate(t.wallpaper.deleteAlt, { name: item.name })}
                onPress={() => void removeItem(item)}
              >
                <Text style={dangerStyle}>{t.wallpaper.delete}</Text>
              </Pressable>
            </View>
          </SettingsRow>
        ))}
      </SettingsCard>

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
